#!/usr/bin/env python3
"""
Design Slop Detector — 58 checks for AI-generated design patterns.
Built 2026-08-04.
Inspired by impeccable.style's detector approach.

Usage:
  python3 slop-detector.py --input path/ --format html|css|jsx|mdx [--fix] [--json]
"""

import re
import sys
import json
import argparse
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class Finding:
    check_id: str
    severity: str  # CRITICAL, HIGH, MEDIUM, LOW
    category: str
    description: str
    location: str
    fix: str
    auto_fixable: bool = False

# ─── THE 58 SLOP CHECKS ───────────────────────────────────────────

CHECKS = []

def check(severity, category, desc, fix, auto=False):
    """Decorator-register a check function."""
    def decorator(fn):
        CHECKS.append((fn.__name__, severity, category, desc, fix, auto, fn))
        return fn
    return decorator

# ─── COLOR CHECKS ─────────────────────────────────────────────────

@check("CRITICAL", "Color", "AI Beige: background is #fafafa, #f5f5f5, or equivalent", 
       "Use pure white (#fff) or a deliberate off-white with purpose (e.g., #f9f6f0 warm paper)")
def check_ai_beige(content, ext):
    patterns = [r'background:\s*#f[af5][af5][af5][af5]', r'bg-\[#f[af5][af5][af5][af5]\]',
                r'background-color:\s*#f[af5][af5][af5][af5]']
    findings = []
    for p in patterns:
        for m in re.finditer(p, content, re.IGNORECASE):
            findings.append(Finding("S01", "CRITICAL", "Color", "AI Beige background detected", 
                                    f"line ~{content[:m.start()].count(chr(10))+1}", 
                                    "Replace with deliberate color: #fff, #f9f6f0, or a brand-defined background"))
    return findings

@check("HIGH", "Color", "Purple Gradient: linear-gradient from violet/purple to indigo/blue on CTA",
       "Replace with brand accent color. If brand color isn't purple, this is definitely AI default.")
def check_purple_gradient(content, ext):
    patterns = [r'linear-gradient\(.*?(?:violet|purple|#8b|#9b|#7c).*?(?:indigo|blue|#4[bc]|#3[bc]|#5[bc])']
    findings = []
    for p in patterns:
        for m in re.finditer(p, content, re.IGNORECASE):
            findings.append(Finding("S02", "HIGH", "Color", "Purple gradient on CTA/element", 
                                    f"line ~{content[:m.start()].count(chr(10))+1}",
                                    "Use brand primary color. Purple gradients are the #1 AI signature."))
    return findings

@check("MEDIUM", "Color", "Uninspired Gray Scale: #6b7280, #9ca3af, #d1d5db (Tailwind gray defaults)",
       "Choose a deliberate gray with temperature. Warm gray (#78716c stone) or cool gray (#71717a zinc). Never neutral gray.")
def check_default_gray(content, ext):
    patterns = [r'#6b7280', r'#9ca3af', r'#d1d5db', r'#e5e7eb', r'#f3f4f6']
    findings = []
    for p in patterns:
        for m in re.finditer(p, content):
            findings.append(Finding("S03", "MEDIUM", "Color", f"Default neutral gray {p} detected",
                                    f"line ~{content[:m.start()].count(chr(10))+1}",
                                    "Replace with warm gray (stone) or cool gray (zinc). Pure neutral gray is AI-default."))
    return findings

@check("MEDIUM", "Color", "Blue Link Default: #2563eb or similar unreasoned blue for interactive elements",
       "Choose a link color from the brand palette. Default blue signals no design decision was made.")
def check_default_blue(content, ext):
    patterns = [r'#2563eb', r'#3b82f6', r'#1d4ed8']
    findings = []
    for p in patterns:
        for m in re.finditer(p, content):
            findings.append(Finding("S04", "MEDIUM", "Color", f"Default blue {p} for interactive element",
                                    f"line ~{content[:m.start()].count(chr(10))+1}",
                                    "Use brand palette link color. Default blue = no design decision."))
    return findings

@check("HIGH", "Color", "Too many colors without a system (>6 unique hex values outside a defined palette)",
       "Reduce to 3-5 colors: primary, accent, surface, text, border. Every color must come from DESIGN.md.")
def check_too_many_colors(content, ext):
    hex_colors = set(re.findall(r'#[0-9a-fA-F]{6}', content))
    if len(hex_colors) > 8:
        return [Finding("S05", "HIGH", "Color", f"{len(hex_colors)} unique hex colors found (max 8 in a system)",
                        "throughout", "Reduce to defined palette. Max 8 colors in a disciplined system.")]
    return []

@check("LOW", "Color", "Generic dark mode: pure #000 or #111 background with white text",
       "Dark mode needs a dark gray, not black. Use #0a0a0a, #111111, or #1a1a1a with purpose.")
def check_harsh_dark_mode(content, ext):
    findings = []
    if re.search(r'background.*#0{3,6}', content) or re.search(r'background.*#1{3,6}', content):
        findings.append(Finding("S06", "LOW", "Color", "Pure black background in dark mode",
                                "throughout", "Use dark gray (#0a0a0a, #111111), not pure black. Retinal persistence on OLED."))
    return findings

# ─── TYPOGRAPHY CHECKS ────────────────────────────────────────────

@check("CRITICAL", "Typography", "Inter font without customization. The #1 AI typography signature.",
       "If using Inter, customize: letter-spacing, font-feature-settings, weight distribution. Or choose a deliberate alternative.")
def check_inter_default(content, ext):
    if re.search(r'Inter', content, re.IGNORECASE):
        has_custom = any(x in content for x in ['font-feature-settings', 'letter-spacing', 'font-variation-settings', 'tracking-'])
        if not has_custom:
            return [Finding("S07", "CRITICAL", "Typography", "Inter font used without any customization",
                            "font declaration", "Add font-feature-settings: 'cv01'-'cv13', tracking, or choose a distinctive alternative.")]
    return []

@check("HIGH", "Typography", "Italic serif for testimonials/quotes (the 'premium AI' tell)",
       "Move pull quotes to the brand type system, not italic Georgia/Lora/Playfair by default.")
def check_italic_serif_quote(content, ext):
    findings = []
    for m in re.finditer(r'(?:Georgia|Lora|Playfair|Merriweather|Libre\s*Baskerville).*italic', content, re.IGNORECASE):
        if any(q in content[max(0,m.start()-200):m.start()].lower() for q in ['testimonial', 'quote', 'blockquote', 'pull']):
            findings.append(Finding("S08", "HIGH", "Typography", "Italic serif used as 'premium' quote font",
                                    f"line ~{content[:m.start()].count(chr(10))+1}",
                                    "Use brand serif from the design system, not italic-by-default."))
    return findings

@check("MEDIUM", "Typography", "Font stack missing fallbacks: only declares one font family",
       "Every font-family declaration needs a complete stack: primary, fallback, generic.")
def check_missing_font_stack(content, ext):
    findings = []
    for m in re.finditer(r"font-family:\s*(['\"]?[\w\s-]+['\"]?)\s*[;}]", content):
        fam = m.group(1).strip("'\"")
        if ',' not in fam and fam not in ['inherit', 'initial', 'unset']:
            findings.append(Finding("S09", "MEDIUM", "Typography", f"Single font '{fam}' in stack, no fallbacks",
                                    f"line ~{content[:m.start()].count(chr(10))+1}",
                                    f"Add fallback stack: '{fam}', system-ui, sans-serif"))
    return findings

@check("MEDIUM", "Typography", "Line-height too tight for body text (<1.5)",
       "Body text needs 1.5-1.75 line-height. Headings can be tighter. Tight body = hard to read.")
def check_tight_leading(content, ext):
    findings = []
    for m in re.finditer(r'line-height:\s*1\.[0-4]\d*', content):
        findings.append(Finding("S10", "MEDIUM", "Typography", f"Tight line-height for body: {m.group()}",
                                f"line ~{content[:m.start()].count(chr(10))+1}",
                                "Use line-height: 1.5-1.75 for body text. Only headings get <1.4."))
    return findings

@check("LOW", "Typography", "Missing True Small Caps or OpenType features for headings",
       "Enable font-feature-settings: 'smcp', 'c2sc', 'liga', 'kern' for professional typography.")
def check_missing_ot_features(content, ext):
    if 'font-feature-settings' not in content and 'font-variant' not in content:
        return [Finding("S11", "LOW", "Typography", "No OpenType features declared",
                        "font declarations", "Add font-feature-settings for professional typography: 'kern', 'liga' at minimum.")]
    return []

# ─── LAYOUT CHECKS ────────────────────────────────────────────────

@check("HIGH", "Layout", "Feature Grid 3×3: exactly 3 rows of 3 feature cards with emoji headers",
       "Break the grid symmetry. Use 4+2, 5, 2×3 staggered, or a completely different structure.")
def check_feature_grid_3x3(content, ext):
    # Approximate: look for 3 repeated card patterns with emoji headers
    emoji_headers = len(re.findall(r'[🚀⚡🔒🔑🎯💡✨🔥📊📈🎨🛡️🔧⚙️📱💻🌐📡🔮🎪🏆💎🌟💪🧠👁️🗣️👥🤝📝✅❌]', content))
    if emoji_headers >= 6 and 'grid' in content.lower():
        return [Finding("S12", "HIGH", "Layout", f"Possible 3×3 feature grid: {emoji_headers} emoji headers detected",
                        "throughout", "Break the default grid. Use asymmetrical layout, horizontal scroll, or a single-column flow.")]
    return []

@check("MEDIUM", "Layout", "Side-tab navigation: vertical left sidebar with icon+label pattern",
       "This is the default AI dashboard layout. Consider top nav, bottom nav (mobile), or contextual navigation.")
def check_side_tab_nav(content, ext):
    if re.search(r'(?:sidebar|side-nav|left-nav|aside.*nav)', content, re.IGNORECASE):
        flex_col = 'flex-col' in content or 'flex-direction: column' in content or 'flex-direction:column' in content
    if flex_col:
            return [Finding("S13", "MEDIUM", "Layout", "Vertical sidebar navigation pattern",
                            "layout", "Evaluate if top nav or contextual nav would serve the user better.")]
    return []

@check("MEDIUM", "Layout", "Undifferentiated border-radius: all corners use same value (8px or 12px)",
       "Use radius hierarchy: 0 (sharp) for data, 4px for inputs, 8px for cards, 12px for modals, full for pills.")
def check_uniform_radius(content, ext):
    radii = set(re.findall(r'border-radius:\s*(\d+)px', content))
    radii.update(re.findall(r'rounded-(\w+)', content))
    if len(radii) <= 1 and radii:
        return [Finding("S14", "MEDIUM", "Layout", "Uniform border-radius throughout",
                        "throughout", "Create radius hierarchy: 0/4/8/12/16/9999px for different element types.")]
    return []

@check("LOW", "Layout", "Centered content with max-w-[40-48rem] — the default 'essay' layout",
       "Not everything is a Medium article. Use asymmetric layouts, full-bleed sections, side-by-side where appropriate.")
def check_essay_layout(content, ext):
    counts = len(re.findall(r'max-w-\[?[34][0-9]rem\]?', content))
    if counts >= 3:
        return [Finding("S15", "LOW", "Layout", f"Essay-style centered layout: {counts} narrow max-width containers",
                        "throughout", "Break the centered-column pattern. Use asymmetric, full-bleed, or multi-column layouts.")]
    return []

# ─── INTERACTION CHECKS ───────────────────────────────────────────

@check("MEDIUM", "Interaction", "Pulsing dot: animated pulse/glow element as loading indicator",
       "Replace with a branded loader, skeleton screen, or nothing. The pulsing dot is 2023 AI.")
def check_pulsing_dot(content, ext):
    if re.search(r'animate-pulse|animation:\s*pulse|@keyframes\s+pulse', content):
        return [Finding("S16", "MEDIUM", "Interaction", "Pulse animation detected (common 'AI thinking' indicator)",
                        "animation", "Replace with branded loading state or skeleton screen.")]
    return []

@check("MEDIUM", "Interaction", "Generic hover: slight scale(1.02) + shadow. No character.",
       "Design a distinctive hover state: color shift, underline animation, reveal element. Make it memorable.")
def check_generic_hover(content, ext):
    if re.search(r'hover.*scale\(1\.0[123]\)', content) and re.search(r'hover.*shadow', content):
        return [Finding("S17", "MEDIUM", "Interaction", "Generic hover: scale + shadow (AI default)",
                        "hover states", "Design a distinctive hover: color shift, border effect, or animated underline.")]
    return []

@check("LOW", "Interaction", "No focus indicators beyond browser default or removed entirely (outline: none without replacement)",
       "Every interactive element needs a visible focus style. Never remove outline without adding a custom ring.")
def check_missing_focus(content, ext):
    if re.search(r'outline:\s*none', content) and not re.search(r'focus-visible:|focus:', content):
        return [Finding("S18", "LOW", "Interaction", "Focus outline removed without custom replacement",
                        "focus styles", "Add a custom focus ring (ring-2 ring-offset-2). Never remove all focus indicators.")]
    return []

# ─── COMPONENT CHECKS ─────────────────────────────────────────────

@check("HIGH", "Components", "Glassmorphism: backdrop-blur + semi-transparent background on cards",
       "Peak 2024. Replace with solid surfaces, subtle borders, or a different depth treatment entirely.")
def check_glassmorphism(content, ext):
    if re.search(r'backdrop-blur|backdrop-filter:\s*blur', content):
        if re.search(r'background.*rgba\(.*0\.[123]', content) or re.search(r'bg-white/[5678]\d', content):
            return [Finding("S19", "HIGH", "Components", "Glassmorphism card: blur + transparent background",
                            "card component", "Use solid surface with subtle border or shadow. Glassmorphism is 2024 default.")]
    return []

@check("MEDIUM", "Components", "Generic shadow: 0 1px 3px rgba(0,0,0,0.1) or tailwind shadow-sm/md defaults",
       "Design custom shadows with color (not pure black), layered depth, and purpose.")
def check_generic_shadow(content, ext):
    if re.search(r'shadow-sm|shadow-md|box-shadow.*rgba\(0,\s*0,\s*0', content):
        return [Finding("S20", "MEDIUM", "Components", "Generic box-shadow using rgba(0,0,0,x)",
                        "shadows", "Use colored shadows matching the brand palette. Shadows are not just black at lower opacity.")]
    return []

@check("MEDIUM", "Components", "Clipped label: text-overflow: ellipsis without adequate width design",
       "Design for the longest realistic content. Truncation is a layout failure, not a feature.")
def check_clipped_label(content, ext):
    findings = []
    for m in re.finditer(r'text-overflow:\s*ellipsis|truncate', content):
        context = content[max(0,m.start()-50):m.end()+50]
        if 'max-w-' not in context and 'width' not in context:
            findings.append(Finding("S21", "MEDIUM", "Components", "Text truncation without explicit width constraint",
                                    f"line ~{content[:m.start()].count(chr(10))+1}",
                                    "Design for content width. Truncation should be a last resort, not the default."))
    return findings

@check("LOW", "Components", "Stale notification badge: red dot on bell icon (overused pattern)",
       "Use a different notification pattern: number badge, subtle indicator, or inline in the relevant context.")
def check_red_badge(content, ext):
    if re.search(r'bell.*(?:bg-red|#ef4444|#dc2626)', content):
        return [Finding("S22", "LOW", "Components", "Red badge on bell icon notification pattern",
                        "notification", "Consider number badge, contextual indicator, or removing the bell entirely.")]
    return []

# ─── TYPOGRAPHY (MORE) ────────────────────────────────────────────

@check("HIGH", "Typography", "Heading hierarchy missing: all headings same weight or size jumps are too small",
       "Create a clear type scale: display (2.5-3x body), h1 (2x), h2 (1.5x), h3 (1.25x), body (1x).")
def check_heading_hierarchy(content, ext):
    sizes = re.findall(r'(?:h1|h2|h3|h4|\.text-(\w+)).*?font-size:\s*([\d.]+)(rem|px)', content)
    if len(sizes) < 3:
        return [Finding("S23", "HIGH", "Typography", "Insufficient heading hierarchy detected",
                        "typography", "Define clear type scale: display, h1, h2, h3, h4, body, caption, overline.")]
    return []

@check("LOW", "Typography", "Measure too wide: body text columns wider than 75 characters",
       "Ideal reading measure is 45-75 characters. Use max-width: 65ch or equivalent for body text.")
def check_wide_measure(content, ext):
    if re.search(r'max-width.*[89]\dch', content):
        return [Finding("S24", "LOW", "Typography", "Body text measure exceeds comfortable reading width",
                        "text container", "Set max-width: 65ch (45-75 characters) for optimal reading comfort.")]
    return []

# ─── SPACING CHECKS ───────────────────────────────────────────────

@check("MEDIUM", "Spacing", "Tailwind default spacing everywhere: p-4, p-6, p-8, m-4, gap-4, gap-6, gap-8",
       "Use a deliberate spacing scale. Not everything is exactly 16px, 24px, or 32px. Some things should be 20px, 28px, 40px.")
def check_default_spacing(content, ext):
    defaults = len(re.findall(r'\b[p|m][xytrbl]?-([468])\b', content))
    custom = len(re.findall(r'\b[p|m][xytrbl]?-\[(\d+)px\]', content))
    if defaults > 20 and custom < 3:
        return [Finding("S25", "MEDIUM", "Spacing", f"Only Tailwind default spacing ({defaults} uses, {custom} custom)",
                        "throughout", "Introduce deliberative spacing: 20px, 28px, 40px, 60px. Not everything is n×4.")]
    return []

@check("MEDIUM", "Spacing", "No negative space as active element: whitespace is only residual, not compositional",
       "Large, intentional empty areas create focus. Not every pixel needs content.")
def check_cramped(content, ext):
    if re.search(r'p-0|p-1|p-2|gap-0|gap-1|gap-2', content):
        count = len(re.findall(r'p-[012]|gap-[012]', content))
        if count > 10:
            return [Finding("S26", "MEDIUM", "Spacing", f"Very tight spacing: {count} instances of p-0/1/2 or gap-0/1/2",
                            "throughout", "Open up the layout. Whitespace is a design element, not wasted space.")]
    return []

# ─── IMAGE / MEDIA CHECKS ─────────────────────────────────────────

@check("HIGH", "Images", "Unsplash placeholder or generic stock photo aesthetic",
       "Use original photography, illustrations, or data visualizations. Stock photos degrade trust.")
def check_stock_photos(content, ext):
    if re.search(r'unsplash|pexels|shutterstock|stock\.adobe', content, re.IGNORECASE):
        return [Finding("S27", "HIGH", "Images", "Stock photo source detected",
                        "images", "Replace with original photography, custom illustration, or abstract brand graphics.")]
    return []

@check("MEDIUM", "Images", "Abstract blob/shape decoration floating in background (the 'modern SaaS' aesthetic)",
       "Geometric abstract shapes are the new stock photos. If they don't communicate something specific, remove them.")
def check_blob_decoration(content, ext):
    if re.search(r'(?:blob|organic.*shape|abstract.*shape|floating.*(?:circle|shape))', content, re.IGNORECASE):
        return [Finding("S28", "MEDIUM", "Images", "Abstract blob/shape decoration detected",
                        "decorative elements", "Remove unless the shape has specific communicative purpose.")]
    return []

# ─── MOTION CHECKS ────────────────────────────────────────────────

@check("MEDIUM", "Motion", "Fade-in on scroll: the default 'make it alive' animation. Overused.",
       "If every section fades in on scroll, none of them do. Use motion sparingly: once per page, for a reason.")
def check_fade_in_scroll(content, ext):
    if len(re.findall(r'(?:fade.*in|opacity.*0.*scroll|IntersectionObserver.*opacity)', content)) > 3:
        return [Finding("S29", "MEDIUM", "Motion", "Multiple fade-in-on-scroll animations detected",
                        "animations", "Reduce to one intentional motion moment per page.")]
    return []

@check("LOW", "Motion", "No reduced-motion media query: animations play regardless of user preference",
       "Respect prefers-reduced-motion. Every animation should have a disabled state.")
def check_no_reduced_motion(content, ext):
    if re.search(r'@keyframes|animation:|animate-', content):
        if not re.search(r'prefers-reduced-motion|motion-safe', content):
            return [Finding("S30", "LOW", "Motion", "Animations present but no prefers-reduced-motion support",
                            "animations", "Wrap all animations in @media (prefers-reduced-motion: no-preference) or use motion-safe.")]
    return []

# ─── ACCESSIBILITY CHECKS ─────────────────────────────────────────

@check("HIGH", "Accessibility", "Low contrast text: gray text on white/light backgrounds (WCAG AA fail)",
       "Body text needs 4.5:1 contrast minimum. Light gray (#999, #aaa) on white fails.")
def check_low_contrast_text(content, ext):
    findings = []
    # Common low-contrast grays
    for color, name in [('#9ca3af', 'gray-400'), ('#d1d5db', 'gray-300'), ('#e5e7eb', 'gray-200'),
                         ('#6b7280', 'gray-500'), ('#999999', '#999'), ('#aaaaaa', '#aaa')]:
        if color in content:
            findings.append(Finding("S31", "HIGH", "Accessibility", f"Potentially low-contrast text color: {name}",
                                    f"color token {color}", f"Darken to at least #595959 for body text on #fff (4.5:1)."))
    return findings

@check("CRITICAL", "Accessibility", "Missing alt text or empty alt attributes on meaningful images",
       "Every meaningful image needs descriptive alt text. Decorative images need alt='' (empty, not missing).")
def check_missing_alt(content, ext):
    findings = []
    for m in re.finditer(r'<img(?!.*alt=)[^>]*>', content):
        findings.append(Finding("S32", "CRITICAL", "Accessibility", "Image missing alt attribute",
                                f"line ~{content[:m.start()].count(chr(10))+1}", 
                                "Add descriptive alt text for meaningful images, alt='' for decorative."))
    return findings

@check("HIGH", "Accessibility", "Clickable div/span without role, tabindex, or keyboard handler",
       "Interactive elements must be reachable and operable by keyboard. Use <button> or add role='button' tabindex='0'.")
def check_div_button(content, ext):
    findings = []
    for m in re.finditer(r'<div[^>]*onClick[^>]*>(?!.*role=)(?!.*tabIndex)', content):
        findings.append(Finding("S33", "HIGH", "Accessibility", "Clickable div without button role/keyboard support",
                                f"line ~{content[:m.start()].count(chr(10))+1}",
                                "Use <button> element or add role='button' tabindex='0' onKeyDown handler."))
    return findings

# ─── CONTENT CHECKS ───────────────────────────────────────────────

@check("HIGH", "Content", "AI-generated marketing copy: 'unlock', 'supercharge', 'revolutionize', 'game-changer', 'next-gen'",
       "These words signal AI-written marketing. Replace with specific, concrete benefit language.")
def check_ai_copy(content, ext):
    buzzwords = ['unlock', 'supercharge', 'revolutionize', 'game-changer', 'next-gen', 
                 'cutting-edge', 'best-in-class', 'world-class', 'seamless', 'leverage',
                 'empower', 'holistic', 'robust', 'scalable', 'state-of-the-art']
    found = [w for w in buzzwords if re.search(r'\b' + w + r'\b', content, re.IGNORECASE)]
    if found:
        return [Finding("S34", "HIGH", "Content", f"AI-generated marketing language: {', '.join(found[:5])}",
                        "copy", "Replace with specific, concrete benefits. What exactly does the product do?")]
    return []

@check("MEDIUM", "Content", "Lorum ipsum or placeholder text remaining in production code",
       "Placeholder text should never reach production. Replace with real content or remove the component.")
def check_lorem_ipsum(content, ext):
    if re.search(r'Lorem\s+ipsum|lorem\d*', content):
        return [Finding("S35", "MEDIUM", "Content", "Lorem ipsum placeholder text detected",
                        "text content", "Replace with real content. If not ready, hide the component.")]
    return []

@check("LOW", "Content", "Three-em dash or excessive emoji in professional contexts",
       "Emoji clusters reduce trust in B2B/professional contexts. One emoji max per section.")
def check_excessive_emoji(content, ext):
    emoji_count = len(re.findall(r'[\U0001F300-\U0001F9FF\u2600-\u27BF\u2B50\u2702-\u27B0\u200D\uFE0F]', content))
    if emoji_count > 10:
        return [Finding("S36", "LOW", "Content", f"{emoji_count} emoji found in content",
                        "throughout", "Reduce emoji usage. In B2B, emoji clusters reduce perceived professionalism.")]
    return []

# ─── CSS/TECHNICAL CHECKS ─────────────────────────────────────────

@check("MEDIUM", "Technical", "Unused CSS custom properties or utility classes in markup",
       "Clean up unused styles. Dead CSS is technical debt and design ambiguity.")
def check_dead_css(content, ext):
    # Simple check for declared-but-possibly-unused patterns
    custom_props = len(re.findall(r'--[\w-]+:', content))
    if custom_props > 30:
        return [Finding("S37", "MEDIUM", "Technical", f"{custom_props} custom properties declared — verify usage",
                        "CSS", "Audit custom properties. Remove any not actively used.")]
    return []

@check("LOW", "Technical", "Magic numbers in CSS: unexplained pixel values without token or variable",
       "Move magic numbers to design tokens. If a value is used once, question it. If used twice, tokenize it.")
def check_magic_numbers(content, ext):
    magic = re.findall(r':\s*(-?\d+\.?\d*)(px|rem|em|%)(?!.*var\(|.*token)', content)
    if len(magic) > 20:
        return [Finding("S38", "LOW", "Technical", f"{len(magic)} inline values — consider tokenizing",
                        "CSS/JSX", "Extract repeated values to design tokens (CSS custom properties or Tailwind theme).")]
    return []

# ─── BRAND / IDENTITY CHECKS ──────────────────────────────────────

@check("HIGH", "Brand", "No DESIGN.md or brand tokens file referenced in the project",
       "Every project needs a single source of truth for visual design decisions.")
def check_no_design_md(content, ext):
    # This fires per-project, not per-file
    return []  # Deferred to external context check

@check("MEDIUM", "Brand", "Logo is text-only without distinctive typography treatment",
       "A wordmark needs deliberate typography choices (tracking, weight, ligatures, custom letterforms). Raw text = placeholder.")
def check_text_only_logo(content, ext):
    if re.search(r'(?:logo|brand).*(?:<span|<div|<h[123]).*?(?:className|class).*?font', content):
        return [Finding("S39", "MEDIUM", "Brand", "Text-only logo without distinctive typography",
                        "logo component", "Add letter-spacing, custom weight, or ligature control to the wordmark.")]
    return []

# ─── RESPONSIVE CHECKS ────────────────────────────────────────────

@check("MEDIUM", "Responsive", "Desktop-first design: no mobile breakpoints or mobile is an afterthought",
       "Design mobile-first. Every component should work at 375px width before it works at 1440px.")
def check_desktop_first(content, ext):
    min_width = len(re.findall(r'@media.*min-width|sm:|md:|lg:|xl:', content))
    max_width = len(re.findall(r'@media.*max-width|max-\[?\d', content))
    if min_width > 0 and max_width == 0:
        return [Finding("S40", "MEDIUM", "Responsive", "Desktop-first: min-width queries without max-width",
                        "responsive design", "Add max-width breakpoints. Consider mobile-first approach.")]
    return []

@check("LOW", "Responsive", "Fixed pixel widths that break on small screens (w-[400px]+ without responsive alternative)",
       "Every fixed width needs a mobile alternative. Test at 375px.")
def check_fixed_widths(content, ext):
    fixed = len(re.findall(r'w-\[((?:[4-9]\d{2}|1\d{3}))px\]', content))
    if fixed > 5:
        return [Finding("S41", "LOW", "Responsive", f"{fixed} fixed-width elements — verify mobile behavior",
                        "responsive", "Add mobile width alternatives for all fixed-width elements.")]
    return []

# ─── DARK MODE CHECKS ─────────────────────────────────────────────

@check("LOW", "Dark Mode", "Dark mode support: no dark: variants or color-scheme declaration",
       "Add dark mode support. Use dark: variants in Tailwind or @media (prefers-color-scheme: dark).")
def check_no_dark_mode(content, ext):
    if re.search(r'className', content) and not re.search(r'dark:', content):
        if 'bg-white' in content or 'bg-gray-50' in content:
            return [Finding("S42", "LOW", "Dark Mode", "Light-mode assumptions without dark mode support",
                            "color scheme", "Add dark: variants for background and text colors.")]
    return []

# ─── PERFORMANCE CHECKS ───────────────────────────────────────────

@check("LOW", "Performance", "No font-display: swap or font loading strategy declared",
       "Web fonts block rendering. Add font-display: swap and preload critical fonts.")
def check_font_loading(content, ext):
    if re.search(r'@font-face', content) and 'font-display' not in content:
        return [Finding("S43", "LOW", "Performance", "@font-face without font-display strategy",
                        "font loading", "Add font-display: swap to all @font-face declarations.")]
    return []

# ─── MORE COLOR CHECKS ───────────────────────────────────────────

@check("HIGH", "Color", "Green/red for non-status/non-data elements (the 'success/danger' default)",
       "Green and red carry specific meaning (success/error, up/down). Don't use them as decorative colors.")
def check_semantic_colors(content, ext):
    findings = []
    greens = len(re.findall(r'#22c55e|#16a34a|#15803d|green-500|green-600', content))
    reds = len(re.findall(r'#ef4444|#dc2626|#b91c1c|red-500|red-600', content))
    if greens > 3 or reds > 3:
        findings.append(Finding("S44", "HIGH", "Color", f"Green/red used decoratively ({greens}g/{reds}r)",
                                "color usage", "Reserve green/red for semantic meaning only: success/error, data direction."))
    return findings

@check("MEDIUM", "Color", "Hero section: dark blue/purple background with white text (SaaS 2023 default)",
       "Boring hero sections signal 'template'. Try a distinctive background treatment, duotone photo, or bold type.")
def check_saas_hero(content, ext):
    if re.search(r'(?:bg-\[#1[ae]|bg-slate-9|bg-gray-9|bg-blue-9|bg-indigo-9|bg-purple-9)', content):
        if re.search(r'(?:hero|header|banner)', content, re.IGNORECASE):
            return [Finding("S45", "MEDIUM", "Color", "Dark blue/purple hero with white text (SaaS template)",
                            "hero section", "Use distinctive hero: photo, bold typography, brand pattern, or asymmetric layout.")]
    return []

# ─── LAYOUT (MORE) ────────────────────────────────────────────────

@check("MEDIUM", "Layout", "Container padding inconsistent: some sections have px-4, others px-8, no rhythm",
       "Establish a consistent page-level padding rhythm. Every section should align horizontally.")
def check_inconsistent_padding(content, ext):
    paddings = set(re.findall(r'(?:px|pl|pr)-(\d+|\[[\d.]+\w+\])', content))
    if len(paddings) > 5:
        return [Finding("S46", "MEDIUM", "Layout", f"Inconsistent horizontal padding: {len(paddings)} different values",
                        "spacing", "Standardize page-level horizontal padding. Use a consistent rhythm.")]
    return []

@check("LOW", "Layout", "No sticky or fixed navigation for long pages (scrolling loses context)",
       "On pages longer than 3 viewports, add a sticky nav with the primary CTA accessible.")
def check_no_sticky_nav(content, ext):
    if re.search(r'<nav', content) and not re.search(r'sticky|fixed', content):
        return [Finding("S47", "LOW", "Layout", "Navigation not sticky on potentially long page",
                        "navigation", "Consider sticky positioning for nav on pages longer than 3 viewports.")]
    return []

# ─── FORM CHECKS ──────────────────────────────────────────────────

@check("HIGH", "Forms", "Input without label association (no htmlFor/id pair or wrapping label)",
       "Every input needs a properly associated label. Placeholder is not a label.")
def check_input_no_label(content, ext):
    findings = []
    inputs = len(re.findall(r'<input[^>]*>', content))
    labels = len(re.findall(r'<label[^>]*htmlFor|<label[^>]*for=', content))
    if inputs > labels:
        return [Finding("S48", "HIGH", "Forms", f"Inputs ({inputs}) exceed labels ({labels}) — some inputs lack proper labels",
                        "form elements", "Add htmlFor/id pairs or wrap inputs in label elements.")]
    return []

@check("MEDIUM", "Forms", "Error state not communicated in text (only red border)",
       "Form errors need text descriptions, not just red borders. Screen readers can't see color alone.")
def check_error_state_no_text(content, ext):
    if re.search(r'border-red|border-destructive', content) and not re.search(r'aria-describedby|error.*text|error.*message', content):
        return [Finding("S49", "MEDIUM", "Forms", "Error states use color only, no text description",
                        "form validation", "Add descriptive error text with aria-describedby linking to the input.")]
    return []

# ─── EMPTY STATES ─────────────────────────────────────────────────

@check("MEDIUM", "Components", "Empty state: 'No results found' without illustration or guidance",
       "Empty states are opportunities. Show what to do next, not just that nothing exists.")
def check_empty_state(content, ext):
    if re.search(r'No results|No data|Nothing to show|Empty', content):
        if not re.search(r'(?:illustration|image|icon|action|button|Create|Add|Upload)', content, re.IGNORECASE):
            return [Finding("S50", "MEDIUM", "Components", "Empty state without illustration or next action",
                            "empty state", "Add illustration, guidance text, and a clear next action to empty states.")]
    return []

# ─── MODE CHECKS ──────────────────────────────────────────────────

@check("LOW", "Mode", "Operation mode: dashboard uses large decorative elements (waste of task-focused space)",
       "Dashboards are for work. Remove decorative elements. Every pixel serves the task.")
def check_dashboard_decorative(content, ext):
    if re.search(r'(?:dashboard|analytics|admin|workspace)', content, re.IGNORECASE):
        if re.search(r'(?:gradient|blur|shadow-2xl|decoration|ornament)', content):
            return [Finding("S51", "LOW", "Mode", "Decorative elements in dashboard/operational context",
                            "dashboard", "Remove decoration from task surfaces. Dashboards serve function, not feeling.")]
    return []

@check("LOW", "Mode", "Persuade mode: landing page has no social proof section (logos, testimonials, numbers)",
       "Persuasion needs evidence. Add client logos, metrics, testimonials, or case study links.")
def check_no_social_proof(content, ext):
    if re.search(r'(?:hero|landing|cta|sign.?up|pricing)', content, re.IGNORECASE):
        if not re.search(r'(?:testimonial|logo|client|trusted|customer|counter|stat|metric)', content, re.IGNORECASE):
            return [Finding("S52", "LOW", "Mode", "Landing page without social proof elements",
                            "persuade mode", "Add social proof: client logos, testimonials, usage stats, or case studies.")]
    return []

# ─── CHECK 53-58: DESIGN SYSTEM INTEGRITY ────────────────────────

@check("CRITICAL", "System", "Hardcoded values duplicate design tokens: same color/spacing defined inline AND in tokens",
       "If a design token exists for it, use the token. Inline duplicates create drift.")
def check_token_duplication(content, ext):
    # This is a soft check — we look for common patterns
    if len(re.findall(r'#[0-9a-fA-F]{6}', content)) > 10:
        css_vars = len(re.findall(r'var\(--', content))
        if css_vars < 3:
            return [Finding("S53", "CRITICAL", "System", "Hardcoded colors without CSS custom property usage",
                            "throughout", "Use design tokens (CSS custom properties) instead of hardcoded hex values.")]
    return []

@check("MEDIUM", "System", "Inconsistent border treatment: some elements bordered, some not, no rule",
       "Establish a border system: which elements get borders, when, and why.")
def check_inconsistent_borders(content, ext):
    border_solid = len(re.findall(r'border\b(?!-0|--|\.)', content))
    border_none = len(re.findall(r'border-0|border-none|border:\s*none', content))
    if border_solid > 5 and border_none > 5:
        return [Finding("S54", "MEDIUM", "System", "Inconsistent border usage across components",
                        "borders", "Define a border system: which elements always have borders, which never do.")]
    return []

@check("LOW", "System", "Too many font sizes without clear scale (>8 distinct sizes)",
       "A type scale has 6-10 defined sizes. Use the scale; don't add sizes ad-hoc.")
def check_font_size_count(content, ext):
    sizes = set(re.findall(r'(?:text-(\w+)|font-size:\s*([\d.]+)(?:rem|px))', content))
    if len(sizes) > 10:
        return [Finding("S55", "LOW", "System", f"{len(sizes)} distinct font sizes — verify type scale",
                        "typography", "Consolidate to a defined type scale of 8-10 sizes.")]
    return []

@check("MEDIUM", "System", "Z-index chaos: z-50, z-40, z-30 used without a z-index system",
       "Define z-index layers: 0=base, 10=dropdown, 20=sticky, 30=modal, 40=toast, 50=tooltip.")
def check_z_index_chaos(content, ext):
    z_indices = set(re.findall(r'z-(\d+)', content))
    if len(z_indices) > 5:
        return [Finding("S56", "MEDIUM", "System", f"Z-index chaos: {len(z_indices)} different z-index values",
                        "stacking", "Define z-index layers (0/10/20/30/40/50) and use them consistently.")]
    return []

@check("LOW", "System", "No CSS reset or base styles defined (browser defaults may vary)",
       "Start with a CSS reset or base layer to normalize cross-browser rendering.")
def check_no_css_reset(content, ext):
    if ext in ['.css'] and not re.search(r'(?:reset|normalize|box-sizing:\s*border-box)', content):
        return [Finding("S57", "LOW", "System", "No CSS reset/normalize detected",
                        "base styles", "Add a CSS reset or set box-sizing: border-box on all elements.")]
    return []

@check("MEDIUM", "System", "Color palette lacks sufficient range: only 1-2 shades per color",
       "Each color needs 5-9 shades (50-900) for a functional design system. Expand the palette.")
def check_palette_range(content, ext):
    # Check for Tailwind-style shade patterns
    color_vars = len(re.findall(r'--color-\w+-\d{2,3}', content))
    if color_vars > 0 and color_vars < 15:
        return [Finding("S58", "MEDIUM", "System", f"Color palette has only {color_vars} shade tokens — may need expansion",
                        "color tokens", "Each brand color needs 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950 shades.")]
    return []


# ─── DETECTOR ENGINE ──────────────────────────────────────────────

def detect(content: str, ext: str) -> list:
    """Run all checks against content. Return list of Finding objects."""
    findings = []
    for name, severity, category, desc, fix, auto_fixable, fn in CHECKS:
        try:
            result = fn(content, ext)
            if result:
                if isinstance(result, list):
                    findings.extend(result)
                else:
                    findings.append(result)
        except Exception as e:
            findings.append(Finding(name, "LOW", "Internal", f"Check {name} failed: {e}", "detector", "Re-run"))
    return findings


def format_findings(findings: list, format: str = "text") -> str:
    """Format findings for output."""
    if format == "json":
        return json.dumps([f.__dict__ for f in findings], indent=2)
    
    if not findings:
        return "✅ No slop detected. Design is clean."

    by_severity = {"CRITICAL": [], "HIGH": [], "MEDIUM": [], "LOW": []}
    for f in findings:
        by_severity[f.severity].append(f)

    lines = [f"🔍 SLOP DETECTOR — {len(findings)} findings", "=" * 60]
    
    for sev in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]:
        if by_severity[sev]:
            emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "⚪"}
            lines.append(f"\n{emoji[sev]} {sev} ({len(by_severity[sev])})")
            for f in by_severity[sev]:
                lines.append(f"  [{f.check_id}] {f.category}: {f.description}")
                lines.append(f"       📍 {f.location}")
                lines.append(f"       💡 {f.fix}")
    
    lines.append(f"\n{'=' * 60}")
    lines.append(f"CRITICAL: {len(by_severity['CRITICAL'])} | HIGH: {len(by_severity['HIGH'])} | MEDIUM: {len(by_severity['MEDIUM'])} | LOW: {len(by_severity['LOW'])}")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Design Slop Detector — AI design quality checks")
    parser.add_argument("--input", required=True, help="File or directory to scan")
    parser.add_argument("--format", default="html", choices=["html", "css", "jsx", "mdx", "md", "any"],
                        help="File format to scan (default: html)")
    parser.add_argument("--json", action="store_true", help="Output in JSON format")
    parser.add_argument("--fix", action="store_true", help="Auto-fix findings where possible")
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"Error: {args.input} not found")
        sys.exit(1)

    files = [path] if path.is_file() else list(path.rglob(f"*.{args.format}")) + list(path.rglob(f"*.{args.format}x"))
    
    all_findings = []
    for f in files:
        try:
            content = f.read_text()
            ext = f.suffix
            findings = detect(content, ext)
            all_findings.extend(findings)
        except Exception as e:
            print(f"⚠️  Skipped {f}: {e}")

    output = format_findings(all_findings, "json" if args.json else "text")
    print(output)

    # Exit code for CI
    criticals = sum(1 for f in all_findings if f.severity == "CRITICAL")
    highs = sum(1 for f in all_findings if f.severity == "HIGH")
    if criticals > 0:
        sys.exit(3)
    elif highs > 0:
        sys.exit(2)
    elif all_findings:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
