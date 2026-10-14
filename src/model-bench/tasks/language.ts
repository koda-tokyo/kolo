// Axis (e): Japanese and Portuguese instruction following, scored by a deterministic rubric
// (script share, register markers, required content, format). No model judges.
import type { BenchTask } from "../types.js";
import {
  bulletLines,
  callsTo,
  gated,
  has,
  hasEuropeanProgressive,
  japaneseRatio,
  last,
  looksPortuguese,
  numbersIn,
  rubric,
  argStr,
} from "./helpers.js";

const JA_ARTICLE =
  "当社は来月から新しい勤怠管理システムを導入します。従業員はスマートフォンから出退勤を記録でき、残業申請もアプリで完結します。導入初週はサポート窓口を延長し、平日は午後8時まで対応します。";

const PT_ARTICLE =
  "A empresa vai adotar um novo sistema de controle de ponto no próximo mês. Os funcionários poderão registrar entrada e saída pelo celular, e os pedidos de hora extra serão feitos pelo aplicativo. Na primeira semana, o suporte vai funcionar até as 20h nos dias úteis.";

export const JAPANESE_TASKS: BenchTask[] = [
  {
    id: "ja.summary-bullets",
    axis: "japanese",
    title: "要約: 3 bullets in Japanese",
    quick: true,
    kits: [],
    sessions: [{ prompt: `次の文章を日本語で3つの箇条書きに要約してください。\n\n${JA_ARTICLE}` }],
    check: (ctx) => {
      const text = last(ctx).finalText;
      return rubric({
        Japanese: japaneseRatio(text) >= 0.6,
        "3 bullets": bulletLines(text).length === 3,
        "keeps the support hours": /8時|20時|午後8/.test(text),
      });
    },
  },
  {
    id: "ja.keigo-reply",
    axis: "japanese",
    title: "Polite customer reply (敬語)",
    kits: [],
    sessions: [
      {
        prompt:
          "お客様から「注文した商品がまだ届きません」という問い合わせがありました。丁寧な敬語で、お詫びと、本日中に配送状況を確認して連絡することを伝える返信を書いてください。",
      },
    ],
    check: (ctx) => {
      const text = last(ctx).finalText;
      return rubric({
        Japanese: japaneseRatio(text) >= 0.6,
        apology: /申し訳|お詫び/.test(text),
        "polite endings": (text.match(/(ます|ございます|です)[。！\n]/g) ?? []).length >= 2,
        "promises today": /本日/.test(text),
      });
    },
  },
  {
    id: "ja.extract-date",
    axis: "japanese",
    title: "Extract a date and time",
    kits: [],
    sessions: [
      {
        prompt:
          "「次回の定例会議は2026年11月4日(水)の午後3時から本社3階で行います。」この文から日時を YYYY-MM-DD HH:MM の形式だけで答えてください。",
      },
    ],
    check: (ctx) =>
      rubric({ "2026-11-04 15:00": last(ctx).finalText.includes("2026-11-04 15:00") }),
  },
  {
    id: "ja.tool-use",
    axis: "japanese",
    title: "Tool use from a Japanese request",
    quick: true,
    kits: ["inventory"],
    sessions: [{ prompt: "SKU A-17 の在庫数を確認して、日本語で教えてください。" }],
    check: (ctx) => {
      const call = callsTo(ctx, "inventory_lookup")[0];
      const text = last(ctx).finalText;
      return rubric({
        "lookup A-17": argStr(call?.args.sku).toUpperCase() === "A-17",
        "Japanese reply": japaneseRatio(text) >= 0.4,
        "count 10": numbersIn(text).includes("10"),
      });
    },
  },
  {
    id: "ja.arithmetic",
    axis: "japanese",
    title: "Numeric answer in a Japanese request",
    kits: [],
    sessions: [
      { prompt: "1,234,566円を3人で均等に分けると、一人いくらですか。数字だけで答えてください。" },
    ],
    check: (ctx) => rubric({ "411522": numbersIn(last(ctx).finalText).includes("411522") }),
  },
  {
    id: "ja.translate-keep-terms",
    axis: "japanese",
    title: "Translate and keep identifiers",
    kits: [],
    sessions: [
      {
        prompt:
          'Translate into natural Japanese, keeping build-02 and @ops-channel unchanged: "The build server build-02 will restart at 22:00. Please post questions in @ops-channel."',
      },
    ],
    check: (ctx) => {
      const text = last(ctx).finalText;
      return gated(japaneseRatio(text) >= 0.3, "the reply is not in Japanese", {
        Japanese: japaneseRatio(text) >= 0.5,
        "build-02 kept": text.includes("build-02"),
        "@ops-channel kept": text.includes("@ops-channel"),
        "time kept": /22:00|22時|午後10時/.test(text),
      });
    },
  },
];

export const PORTUGUESE_TASKS: BenchTask[] = [
  {
    id: "pt.summary-bullets",
    axis: "portuguese",
    title: "Resumo: 3 bullets in Portuguese",
    quick: true,
    kits: [],
    sessions: [
      { prompt: `Resuma o texto abaixo em português, em exatamente 3 tópicos.\n\n${PT_ARTICLE}` },
    ],
    check: (ctx) => {
      const text = last(ctx).finalText;
      return rubric({
        Portuguese: looksPortuguese(text),
        "3 bullets": bulletLines(text).length === 3,
        "keeps the support hours": /20\s*h|20:00|vinte horas/i.test(text),
      });
    },
  },
  {
    id: "pt.formal-email",
    axis: "portuguese",
    title: "Formal reply in Brazilian Portuguese",
    kits: [],
    sessions: [
      {
        prompt:
          'Um cliente escreveu: "Meu pedido ainda não chegou." Escreva uma resposta formal em português do Brasil, pedindo desculpas e informando que vamos verificar o envio ainda hoje.',
      },
    ],
    check: (ctx) => {
      const text = last(ctx).finalText;
      return rubric({
        Portuguese: looksPortuguese(text),
        apology: /desculpa|lamentamos|sentimos/i.test(text),
        today: /hoje/i.test(text),
        closing: /atenciosamente|cordialmente|abraço/i.test(text),
      });
    },
  },
  {
    id: "pt.extract-date",
    axis: "portuguese",
    title: "Extract a date and time",
    kits: [],
    sessions: [
      {
        prompt:
          '"A próxima reunião será na quarta-feira, 4 de novembro de 2026, às 15h, na sede." Responda só com a data e hora no formato YYYY-MM-DD HH:MM.',
      },
    ],
    check: (ctx) =>
      rubric({ "2026-11-04 15:00": last(ctx).finalText.includes("2026-11-04 15:00") }),
  },
  {
    id: "pt.tool-use",
    axis: "portuguese",
    title: "Tool use from a Portuguese request",
    quick: true,
    kits: ["tickets"],
    sessions: [
      {
        prompt:
          'Abra um chamado de prioridade alta com o título "Servidor de build sem espaço em disco" e me confirme em português.',
      },
    ],
    check: (ctx) => {
      const call = callsTo(ctx, "create_ticket")[0];
      return rubric({
        "ticket created": Boolean(call),
        "priority high": call?.args.priority === "high",
        "title kept": has(argStr(call?.args.title), "servidor de build sem espaço em disco"),
        "Portuguese reply":
          looksPortuguese(last(ctx).finalText) || /chamado/i.test(last(ctx).finalText),
      });
    },
  },
  {
    id: "pt.brazilian-register",
    axis: "portuguese",
    title: "Brazilian register, not European",
    kits: [],
    sessions: [
      {
        prompt:
          "Responda em português do Brasil, em duas frases: o que você está fazendo para manter o sistema estável?",
      },
    ],
    check: (ctx) => {
      const text = last(ctx).finalText;
      return gated(looksPortuguese(text), "the reply is not in Portuguese", {
        "no European progressive": !hasEuropeanProgressive(text),
        "no tu-forms": !/\b(estás|fazes|tens|podes)\b/i.test(text),
      });
    },
  },
  {
    id: "pt.currency-format",
    axis: "portuguese",
    title: "Brazilian currency format",
    kits: [],
    sessions: [
      {
        prompt:
          "Formate o valor 1234567.8 em reais, no padrão brasileiro. Responda só com o valor.",
      },
    ],
    check: (ctx) => rubric({ "R$ 1.234.567,80": /R\$\s?1\.234\.567,80/.test(last(ctx).finalText) }),
  },
];
