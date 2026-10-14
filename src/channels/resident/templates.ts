// System reply templates for channels (KoLo 2.0, M14): help, approvals, errors, status lines.
// English is the source; Japanese and Portuguese are selected by the channel locale
// (`channels.<id>.locale`, then `channels.locale`, default `en`). Keys are stable identifiers
// and call sites never carry prose in more than one language. No vendor names, no emoji.
import type { KoLoConfig } from "../../config/config.js";
import type { ChannelLocale } from "../../config/types.channels-resident.js";

export const CHANNEL_LOCALES: readonly ChannelLocale[] = ["en", "ja", "pt"];

type Entry = { en: string; ja: string; pt: string };

const MESSAGES: Record<string, Entry> = {
  "help.title": {
    en: "Commands you can use here:",
    ja: "ここで使えるコマンド:",
    pt: "Comandos disponíveis aqui:",
  },
  "help.status": {
    en: "/status  resident, session and running jobs",
    ja: "/status  常駐エージェント、セッション、実行中のジョブ",
    pt: "/status  residente, sessão e jobs em execução",
  },
  "help.jobs": { en: "/jobs  recent jobs", ja: "/jobs  最近のジョブ", pt: "/jobs  jobs recentes" },
  "help.cancel": {
    en: "/cancel <id>  stop a running job",
    ja: "/cancel <id>  実行中のジョブを停止",
    pt: "/cancel <id>  interrompe um job em execução",
  },
  "help.evidence": {
    en: "/evidence <jobId>  report of what a job did",
    ja: "/evidence <jobId>  ジョブの実行レポート",
    pt: "/evidence <jobId>  relatório do que o job fez",
  },
  "help.pause": {
    en: "/pause  stop answering in this conversation",
    ja: "/pause  この会話での応答を停止",
    pt: "/pause  para de responder nesta conversa",
  },
  "help.resume": {
    en: "/resume  answer again",
    ja: "/resume  応答を再開",
    pt: "/resume  volta a responder",
  },
  "help.approve": {
    en: "approve <id> | deny <id>  answer a pending approval",
    ja: "approve <id> | deny <id>  承認待ちに回答",
    pt: "approve <id> | deny <id>  responde a uma aprovação pendente",
  },
  "help.help": { en: "/help  this list", ja: "/help  この一覧", pt: "/help  esta lista" },
  "help.role": {
    en: "Your role here: {role}.",
    ja: "あなたの権限: {role}。",
    pt: "Seu papel aqui: {role}.",
  },
  "error.notPermitted": {
    en: "You are not allowed to run {command} here.",
    ja: "{command} を実行する権限がありません。",
    pt: "Você não tem permissão para executar {command} aqui.",
  },
  "error.unknownIdentity": {
    en: "This sender is not configured for commands on this channel.",
    ja: "この送信者はこのチャネルでコマンドを使う設定がありません。",
    pt: "Este remetente não está configurado para comandos neste canal.",
  },
  "error.missingArg": {
    en: "Usage: {usage}",
    ja: "使い方: {usage}",
    pt: "Uso: {usage}",
  },
  "error.generic": {
    en: "The command failed ({reason}).",
    ja: "コマンドに失敗しました ({reason})。",
    pt: "O comando falhou ({reason}).",
  },
  "status.line": {
    en: "resident {agent}\nsession {session}\nconversation {mode}\njobs running {running}, queued {queued}\nlast job {last}",
    ja: "常駐 {agent}\nセッション {session}\n会話 {mode}\nジョブ 実行中 {running}、待機 {queued}\n最新ジョブ {last}",
    pt: "residente {agent}\nsessão {session}\nconversa {mode}\njobs em execução {running}, na fila {queued}\núltimo job {last}",
  },
  "status.paused": { en: "paused", ja: "一時停止中", pt: "pausada" },
  "status.active": { en: "active", ja: "応答中", pt: "ativa" },
  "status.none": { en: "none", ja: "なし", pt: "nenhum" },
  "jobs.empty": { en: "No jobs yet.", ja: "ジョブはまだありません。", pt: "Ainda não há jobs." },
  "jobs.header": { en: "Recent jobs:", ja: "最近のジョブ:", pt: "Jobs recentes:" },
  "cancel.ok": {
    en: "Job {id} cancelled.",
    ja: "ジョブ {id} をキャンセルしました。",
    pt: "Job {id} cancelado.",
  },
  "cancel.notFound": {
    en: "No job with id {id}.",
    ja: "ID {id} のジョブはありません。",
    pt: "Não há job com o id {id}.",
  },
  "cancel.finished": {
    en: "Job {id} already finished ({status}).",
    ja: "ジョブ {id} はすでに終了しています ({status})。",
    pt: "O job {id} já terminou ({status}).",
  },
  "evidence.none": {
    en: "No evidence recorded for job {id}.",
    ja: "ジョブ {id} の証跡はありません。",
    pt: "Nenhuma evidência registrada para o job {id}.",
  },
  "pause.ok": {
    en: "Paused. I will not answer in this conversation until /resume.",
    ja: "一時停止しました。/resume まではこの会話に応答しません。",
    pt: "Pausado. Não vou responder nesta conversa até /resume.",
  },
  "pause.already": {
    en: "Already paused.",
    ja: "すでに一時停止中です。",
    pt: "Já está pausado.",
  },
  "resume.ok": { en: "Resumed.", ja: "再開しました。", pt: "Retomado." },
  "resume.already": {
    en: "Not paused.",
    ja: "一時停止中ではありません。",
    pt: "Não está pausado.",
  },
  "paused.notice": {
    en: "This conversation is paused. Send /resume to continue.",
    ja: "この会話は一時停止中です。続けるには /resume を送ってください。",
    pt: "Esta conversa está pausada. Envie /resume para continuar.",
  },
  "approval.ask": {
    en: "Approval needed ({kind}).\nid {id}\n{summary}\nExpires in {expires}.\nReply: approve {id} or deny {id}",
    ja: "承認が必要です ({kind})。\nid {id}\n{summary}\n有効期限 {expires}。\n返信: approve {id} または deny {id}",
    pt: "Aprovação necessária ({kind}).\nid {id}\n{summary}\nExpira em {expires}.\nResponda: approve {id} ou deny {id}",
  },
  "approval.button.approve": { en: "Approve", ja: "承認", pt: "Aprovar" },
  "approval.button.deny": { en: "Deny", ja: "拒否", pt: "Negar" },
  "approval.resolved": {
    en: "Approval {id}: {decision} (by {by}).",
    ja: "承認 {id}: {decision} ({by})。",
    pt: "Aprovação {id}: {decision} (por {by}).",
  },
  "approval.expired": {
    en: "Approval {id} expired without an answer.",
    ja: "承認 {id} は回答がないまま期限切れになりました。",
    pt: "A aprovação {id} expirou sem resposta.",
  },
  "approval.unknown": {
    en: "No pending approval with id {id}.",
    ja: "ID {id} の承認待ちはありません。",
    pt: "Não há aprovação pendente com o id {id}.",
  },
  "approval.decision.allow-once": {
    en: "allowed once",
    ja: "今回のみ許可",
    pt: "permitido uma vez",
  },
  "approval.decision.allow-always": {
    en: "allowed always",
    ja: "常に許可",
    pt: "sempre permitido",
  },
  "approval.decision.deny": { en: "denied", ja: "拒否", pt: "negado" },
  "attachment.saved": {
    en: "{count} attachment(s) saved to the inbox.",
    ja: "添付ファイル {count} 件を受信箱に保存しました。",
    pt: "{count} anexo(s) salvo(s) na caixa de entrada.",
  },
  "attachment.tooLarge": {
    en: "Attachment {name} skipped: larger than {limit}.",
    ja: "添付 {name} は {limit} を超えるため保存しませんでした。",
    pt: "Anexo {name} ignorado: maior que {limit}.",
  },
  "role.owner": { en: "owner", ja: "オーナー", pt: "proprietário" },
  "role.admin": { en: "admin", ja: "管理者", pt: "administrador" },
  "role.attach": { en: "attach", ja: "閲覧", pt: "acompanhar" },
  "role.none": { en: "not configured", ja: "未設定", pt: "não configurado" },
};

export function isChannelLocale(value: unknown): value is ChannelLocale {
  return value === "en" || value === "ja" || value === "pt";
}

/** `channels.<id>.accounts.<acct>.locale` → `channels.<id>.locale` → `channels.locale` → en. */
export function resolveChannelLocale(
  cfg: KoLoConfig,
  channel?: string | null,
  accountId?: string | null,
): ChannelLocale {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  if (channel) {
    const entry = channels?.[channel.toLowerCase()];
    if (entry && typeof entry === "object") {
      const rec = entry as { locale?: unknown; accounts?: Record<string, unknown> };
      const acct =
        accountId && rec.accounts && typeof rec.accounts === "object"
          ? (rec.accounts[accountId] as { locale?: unknown } | undefined)
          : undefined;
      if (isChannelLocale(acct?.locale)) {
        return acct.locale;
      }
      if (isChannelLocale(rec.locale)) {
        return rec.locale;
      }
    }
  }
  const top = (channels as { locale?: unknown } | undefined)?.locale;
  return isChannelLocale(top) ? top : "en";
}

export function channelText(
  locale: ChannelLocale,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const entry = MESSAGES[key];
  let text = entry ? (entry[locale] ?? entry.en) : key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

export function hasChannelText(key: string): boolean {
  return Object.hasOwn(MESSAGES, key);
}

export function channelTextKeys(): string[] {
  return Object.keys(MESSAGES);
}
