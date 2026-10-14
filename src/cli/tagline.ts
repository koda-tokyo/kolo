// One product line under the banner. No rotation, no jokes, no holiday variants: a buyer who
// runs `--help` twice must see the same text twice (docs/CLI_STYLE.md).

import { t } from "../i18n/index.js";

export const PRODUCT_TAGLINE = "resident agent runtime";

export type TaglineOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

export function pickTagline(_options: TaglineOptions = {}): string {
  return t("tagline");
}
