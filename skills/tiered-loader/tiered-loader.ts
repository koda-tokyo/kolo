/**
 * Tiered Context Loader
 * 
 * Load workspace context progressively:
 * - L0: Directory tree only (minimal tokens)
 * - L1: Metadata + previews (moderate tokens)
 * - L2: Full content (maximum detail)
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface LoaderConfig {
  basePath: string;
  maxDepth?: number;
  respectGitignore?: boolean;
  previewLines?: number;
  maxFileSize?: number;        // Skip files larger than this (bytes)
  tokenBudget?: number;        // Max tokens for L1/L2 operations
}

interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modified: Date;
  children?: FileEntry[];
}

interface FileMetadata extends FileEntry {
  extension: string;
  encoding: 'utf-8' | 'binary';
  lineCount?: number;
  preview?: string;
  summary?: string;
  tokens?: number;
}

interface FileContent extends FileMetadata {
  content: string;
  truncated: boolean;
}

interface LoadResult<T> {
  data: T;
  tokensUsed: number;
  filesProcessed: number;
  timeMs: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.sqlite', '.db',
]);

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.next',
  '__pycache__',
  '.pytest_cache',
  'dist',
  'build',
  '.cache',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function shouldIgnore(name: string): boolean {
  return IGNORE_PATTERNS.includes(name) || name.startsWith('.');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function generateSummary(content: string, maxLines: number = 5): string {
  const lines = content.split('\n');
  const summaryParts: string[] = [];
  
  // First line (often important)
  if (lines[0]) summaryParts.push(lines[0].trim());
  
  // Look for key patterns
  const patterns = [
    /^#\s+(.+)/,                    // Markdown headers
    /^export\s+(default\s+)?/,      // Exports
    /^(class|function|const|let)\s+\w+/, // Declarations
    /^import\s+/,                   // Imports (count only)
  ];
  
  let importCount = 0;
  for (const line of lines.slice(1)) {
    if (/^import\s+/.test(line)) {
      importCount++;
      continue;
    }
    
    for (const pattern of patterns) {
      if (pattern.test(line) && summaryParts.length < maxLines) {
        summaryParts.push(line.trim().slice(0, 80));
        break;
      }
    }
  }
  
  if (importCount > 0) {
    summaryParts.unshift(`[${importCount} imports]`);
  }
  
  return summaryParts.slice(0, maxLines).join('\n');
}

// ============================================================================
// Gitignore Parser
// ============================================================================

function parseGitignore(basePath: string): (relativePath: string) => boolean {
  const gitignorePath = path.join(basePath, '.gitignore');
  const patterns: RegExp[] = [];
  
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Convert gitignore pattern to regex
      let pattern = trimmed
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      
      if (trimmed.startsWith('/')) {
        pattern = `^${pattern.slice(1)}`;
      } else {
        pattern = `(^|/)${pattern}`;
      }
      
      if (trimmed.endsWith('/')) {
        pattern = pattern.slice(0, -1);
      }
      
      patterns.push(new RegExp(pattern));
    }
  }
  
  return (relativePath: string) => {
    for (const pattern of patterns) {
      if (pattern.test(relativePath)) return true;
    }
    return false;
  };
}

// ============================================================================
// Tiered Loader Class
// ============================================================================

export class TieredLoader {
  private config: Required<LoaderConfig>;
  private gitignoreCheck: (path: string) => boolean;
  
  constructor(config: LoaderConfig) {
    this.config = {
      basePath: config.basePath,
      maxDepth: config.maxDepth ?? 10,
      respectGitignore: config.respectGitignore ?? true,
      previewLines: config.previewLines ?? 50,
      maxFileSize: config.maxFileSize ?? 1024 * 1024, // 1MB
      tokenBudget: config.tokenBudget ?? 50000,
    };
    
    this.gitignoreCheck = this.config.respectGitignore 
      ? parseGitignore(this.config.basePath)
      : () => false;
  }
  
  // ==========================================================================
  // L0: Directory Tree
  // ==========================================================================
  
  /**
   * Load directory tree - minimal token usage.
   * Returns a tree structure with file names, types, and sizes.
   */
  loadL0(subPath: string = ''): LoadResult<FileEntry> {
    const startTime = Date.now();
    let filesProcessed = 0;
    
    const scan = (dirPath: string, relativePath: string, depth: number): FileEntry | null => {
      if (depth > this.config.maxDepth) return null;
      
      const name = path.basename(dirPath);
      if (shouldIgnore(name) && depth > 0) return null;
      if (this.gitignoreCheck(relativePath)) return null;
      
      let stats: fs.Stats;
      try {
        stats = fs.statSync(dirPath);
      } catch {
        return null;
      }
      
      filesProcessed++;
      
      const entry: FileEntry = {
        name,
        path: dirPath,
        relativePath,
        type: stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file',
        size: stats.size,
        modified: stats.mtime,
      };
      
      if (stats.isDirectory()) {
        try {
          const children = fs.readdirSync(dirPath);
          entry.children = children
            .map(child => scan(
              path.join(dirPath, child),
              path.join(relativePath, child),
              depth + 1
            ))
            .filter((c): c is FileEntry => c !== null)
            .sort((a, b) => {
              // Directories first, then alphabetical
              if (a.type === 'directory' && b.type !== 'directory') return -1;
              if (a.type !== 'directory' && b.type === 'directory') return 1;
              return a.name.localeCompare(b.name);
            });
        } catch {
          entry.children = [];
        }
      }
      
      return entry;
    };
    
    const fullPath = path.join(this.config.basePath, subPath);
    const data = scan(fullPath, subPath || '.', 0);
    
    if (!data) {
      throw new Error(`Path not found: ${fullPath}`);
    }
    
    return {
      data,
      tokensUsed: estimateTokens(this.formatL0(data)),
      filesProcessed,
      timeMs: Date.now() - startTime,
    };
  }
  
  /**
   * Format L0 result as a readable tree.
   */
  formatL0(entry: FileEntry, indent: string = ''): string {
    const lines: string[] = [];
    const icon = entry.type === 'directory' ? '📁' : '📄';
    const size = entry.type === 'file' ? ` (${formatSize(entry.size)})` : '';
    
    lines.push(`${indent}${icon} ${entry.name}${size}`);
    
    if (entry.children) {
      const lastIndex = entry.children.length - 1;
      entry.children.forEach((child, i) => {
        const prefix = i === lastIndex ? '└── ' : '├── ';
        const childIndent = i === lastIndex ? '    ' : '│   ';
        const childOutput = this.formatL0(child, childIndent);
        lines.push(indent + prefix + childOutput.slice(childIndent.length));
      });
    }
    
    return lines.join('\n');
  }
  
  // ==========================================================================
  // L1: Metadata + Previews
  // ==========================================================================
  
  /**
   * Load metadata and previews for files in a directory.
   */
  loadL1(subPath: string = ''): LoadResult<FileMetadata[]> {
    const startTime = Date.now();
    let tokensUsed = 0;
    const files: FileMetadata[] = [];
    
    const processDir = (dirPath: string, relativePath: string, depth: number): void => {
      if (depth > this.config.maxDepth) return;
      if (tokensUsed > this.config.tokenBudget) return;
      
      const name = path.basename(dirPath);
      if (shouldIgnore(name) && depth > 0) return;
      if (this.gitignoreCheck(relativePath)) return;
      
      let stats: fs.Stats;
      try {
        stats = fs.statSync(dirPath);
      } catch {
        return;
      }
      
      if (stats.isDirectory()) {
        try {
          const children = fs.readdirSync(dirPath);
          for (const child of children) {
            processDir(
              path.join(dirPath, child),
              path.join(relativePath, child),
              depth + 1
            );
          }
        } catch {
          return;
        }
      } else if (stats.isFile()) {
        const metadata = this.getFileMetadata(dirPath, relativePath, stats);
        if (metadata) {
          files.push(metadata);
          tokensUsed += metadata.tokens || 0;
        }
      }
    };
    
    const fullPath = path.join(this.config.basePath, subPath);
    processDir(fullPath, subPath || '.', 0);
    
    return {
      data: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      tokensUsed,
      filesProcessed: files.length,
      timeMs: Date.now() - startTime,
    };
  }
  
  private getFileMetadata(filePath: string, relativePath: string, stats: fs.Stats): FileMetadata | null {
    const ext = path.extname(filePath).toLowerCase();
    const isBinary = isBinaryFile(filePath);
    
    const metadata: FileMetadata = {
      name: path.basename(filePath),
      path: filePath,
      relativePath,
      type: 'file',
      size: stats.size,
      modified: stats.mtime,
      extension: ext,
      encoding: isBinary ? 'binary' : 'utf-8',
    };
    
    // Skip large files
    if (stats.size > this.config.maxFileSize) {
      metadata.summary = `[File too large: ${formatSize(stats.size)}]`;
      metadata.tokens = estimateTokens(this.formatFileMetadata(metadata));
      return metadata;
    }
    
    // Skip binary files for content
    if (isBinary) {
      metadata.summary = `[Binary file: ${ext}]`;
      metadata.tokens = estimateTokens(this.formatFileMetadata(metadata));
      return metadata;
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      metadata.lineCount = lines.length;
      
      // Preview: first N lines
      metadata.preview = lines.slice(0, this.config.previewLines).join('\n');
      
      // Summary for larger files
      if (lines.length > this.config.previewLines) {
        metadata.summary = generateSummary(content);
      }
      
      metadata.tokens = estimateTokens(this.formatFileMetadata(metadata));
    } catch {
      metadata.summary = '[Error reading file]';
      metadata.tokens = estimateTokens(this.formatFileMetadata(metadata));
    }
    
    return metadata;
  }
  
  formatFileMetadata(metadata: FileMetadata): string {
    const lines = [
      `## ${metadata.relativePath}`,
      `Size: ${formatSize(metadata.size)} | Modified: ${formatDate(metadata.modified)} | Lines: ${metadata.lineCount ?? 'N/A'}`,
    ];
    
    if (metadata.summary) {
      lines.push(`Summary: ${metadata.summary}`);
    }
    
    if (metadata.preview) {
      lines.push('```' + metadata.extension.slice(1));
      lines.push(metadata.preview);
      if (metadata.lineCount && metadata.lineCount > this.config.previewLines) {
        lines.push(`... [${metadata.lineCount - this.config.previewLines} more lines]`);
      }
      lines.push('```');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Format L1 result as readable output.
   */
  formatL1(files: FileMetadata[]): string {
    return files.map(f => this.formatFileMetadata(f)).join('\n\n---\n\n');
  }
  
  // ==========================================================================
  // L2: Full Content
  // ==========================================================================
  
  /**
   * Load full content of a specific file or directory.
   */
  loadL2(subPath: string): LoadResult<FileContent[]> {
    const startTime = Date.now();
    let tokensUsed = 0;
    const files: FileContent[] = [];
    
    const fullPath = path.join(this.config.basePath, subPath);
    const stats = fs.statSync(fullPath);
    
    if (stats.isFile()) {
      const content = this.getFileContent(fullPath, subPath, stats);
      if (content) {
        files.push(content);
        tokensUsed += content.tokens || 0;
      }
    } else if (stats.isDirectory()) {
      const processDir = (dirPath: string, relativePath: string): void => {
        if (tokensUsed > this.config.tokenBudget) return;
        
        const name = path.basename(dirPath);
        if (shouldIgnore(name)) return;
        if (this.gitignoreCheck(relativePath)) return;
        
        const dirStats = fs.statSync(dirPath);
        
        if (dirStats.isDirectory()) {
          const children = fs.readdirSync(dirPath);
          for (const child of children) {
            processDir(
              path.join(dirPath, child),
              path.join(relativePath, child)
            );
          }
        } else if (dirStats.isFile()) {
          const content = this.getFileContent(dirPath, relativePath, dirStats);
          if (content) {
            files.push(content);
            tokensUsed += content.tokens || 0;
          }
        }
      };
      
      processDir(fullPath, subPath);
    }
    
    return {
      data: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      tokensUsed,
      filesProcessed: files.length,
      timeMs: Date.now() - startTime,
    };
  }
  
  private getFileContent(filePath: string, relativePath: string, stats: fs.Stats): FileContent | null {
    const ext = path.extname(filePath).toLowerCase();
    const isBinary = isBinaryFile(filePath);
    
    const fileContent: FileContent = {
      name: path.basename(filePath),
      path: filePath,
      relativePath,
      type: 'file',
      size: stats.size,
      modified: stats.mtime,
      extension: ext,
      encoding: isBinary ? 'binary' : 'utf-8',
      content: '',
      truncated: false,
    };
    
    if (isBinary) {
      fileContent.content = `[Binary file: ${ext}, ${formatSize(stats.size)}]`;
      fileContent.tokens = estimateTokens(fileContent.content);
      return fileContent;
    }
    
    if (stats.size > this.config.maxFileSize) {
      fileContent.content = `[File too large: ${formatSize(stats.size)}]`;
      fileContent.truncated = true;
      fileContent.tokens = estimateTokens(fileContent.content);
      return fileContent;
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const tokens = estimateTokens(content);
      
      // Check if we'd exceed budget
      if (tokens > this.config.tokenBudget / 2) {
        // Truncate to fit
        const maxChars = (this.config.tokenBudget / 2) * 4;
        fileContent.content = content.slice(0, maxChars) + '\n[...truncated...]';
        fileContent.truncated = true;
      } else {
        fileContent.content = content;
      }
      
      fileContent.lineCount = content.split('\n').length;
      fileContent.tokens = estimateTokens(fileContent.content);
    } catch (e) {
      fileContent.content = `[Error reading file: ${e}]`;
      fileContent.tokens = estimateTokens(fileContent.content);
    }
    
    return fileContent;
  }
  
  /**
   * Format L2 result as readable output.
   */
  formatL2(files: FileContent[]): string {
    return files.map(f => {
      const header = [
        `## ${f.relativePath}`,
        `Size: ${formatSize(f.size)} | Lines: ${f.lineCount ?? 'N/A'}${f.truncated ? ' | TRUNCATED' : ''}`,
      ].join('\n');
      
      const ext = f.extension.slice(1) || 'txt';
      const codeBlock = '```' + ext + '\n' + f.content + '\n```';
      
      return header + '\n\n' + codeBlock;
    }).join('\n\n---\n\n');
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const tier = args[0]?.toUpperCase() as 'L0' | 'L1' | 'L2';
  const targetPath = args[1] || '.';
  const basePath = args[2] || process.cwd();
  
  const loader = new TieredLoader({ basePath });
  
  try {
    if (tier === 'L0') {
      const result = loader.loadL0(targetPath);
      console.log(loader.formatL0(result.data));
      console.error(`\n[L0] ${result.filesProcessed} files, ~${result.tokensUsed} tokens, ${result.timeMs}ms`);
    } else if (tier === 'L1') {
      const result = loader.loadL1(targetPath);
      console.log(loader.formatL1(result.data));
      console.error(`\n[L1] ${result.filesProcessed} files, ~${result.tokensUsed} tokens, ${result.timeMs}ms`);
    } else if (tier === 'L2') {
      const result = loader.loadL2(targetPath);
      console.log(loader.formatL2(result.data));
      console.error(`\n[L2] ${result.filesProcessed} files, ~${result.tokensUsed} tokens, ${result.timeMs}ms`);
    } else {
      console.log(`
Tiered Context Loader

Usage:
  npx ts-node tiered-loader.ts L0 [path] [basePath]   - Directory tree
  npx ts-node tiered-loader.ts L1 [path] [basePath]   - Metadata + previews
  npx ts-node tiered-loader.ts L2 [path] [basePath]   - Full content

Examples:
  npx ts-node tiered-loader.ts L0 src
  npx ts-node tiered-loader.ts L1 src/components
  npx ts-node tiered-loader.ts L2 src/index.ts
      `);
    }
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  LoaderConfig,
  FileEntry,
  FileMetadata,
  FileContent,
  LoadResult,
  estimateTokens,
  isBinaryFile,
  shouldIgnore,
  formatSize,
};
