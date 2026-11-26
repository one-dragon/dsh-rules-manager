import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
import { Agent } from "@deepseek-ai/dsh-agent";
/**
 * Source recorded on the injected rules message.
 *
 * `MessageSourceMap` is merge-extensible: each producer declares its own
 * `kind` in its own module. This is the same seam the host's own
 * `dsh-agent-instructions` uses for its `'agent-instructions'` kind
 * (`dsh-agent-instructions/src/state.ts`). Declaring it here replaces a cast
 * and makes the source visible to any consumer that switches on `kind`.
 */
interface RulesContextSource {
  readonly kind: 'rules-context';
  readonly form: 'instructions';
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'rules-context': RulesContextSource;
  }
}
/**
 * The session working-directory service, as this plugin uses it.
 *
 * The session directory is the one the agent was opened on. `process.cwd()` is
 * the directory of the DSH host process and has nothing to do with the
 * workspace, so climbing from it finds no project marker and every
 * project-scoped rule is missed.
 *
 * Declared structurally instead of imported from
 * `@deepseek-ai/dsh-working-directory`: that package is a host peer this plugin
 * does not depend on, and `ensure` is the only member used. The host registers
 * the real service under the name listed in the entry's `inject`.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional: the browser-transport service, absent in non-web compositions. */
    readonly connection?: {
      readonly fetch?: {
        register(route: unknown): () => Promise<void> | void;
      };
    };
    workingDirectory: {
      /** The session's absolute directory, restoring the original when it is gone. */
      ensure(agent: Agent, signal?: AbortSignal): Promise<string>;
    };
  }
}
interface Config {
  /**
   * Pins where state.json lives. Empty means **unpinned**, and the fallback
   * chain in `state.ts` decides: `DSH_RULES_MANAGER_HOME`, then
   * `<home>/.dsh/rules-manager`.
   *
   * Empty rather than the resolved home directory on purpose: schemastery
   * cannot tell a default from an explicit value (measured: `Config({})` and
   * `Config({ stateDir: <home> })` produce the same string). A computed default
   * would therefore make `apply`'s `setStateDir` fire on every run and pin the
   * directory, so `DSH_RULES_MANAGER_HOME` could never take effect.
   */
  stateDir: string;
  /**
   * Per-rule cap, in characters. At least 100: the truncation note is itself
   * about 35 characters, so a smaller cap would run past the cap it announces.
   * At most 2,000,000, which is already a megabyte of a single rule.
   */
  perRuleMax: number;
  /** Total cap for user-scope always-on rules, 0 to 2,000,000 characters. */
  userRulesTotal: number;
  /** Total cap for project-scope always-on rules, 0 to 2,000,000 characters. */
  projectRulesTotal: number;
  /** Total cap for one read_rules result, 1,000 to 4,000,000 characters. */
  readRulesOutput: number;
  /**
   * Recursion depth cap per source root. 0 reads the root only. At most 100:
   * the deepest layout any convention documents is four levels, so a pin past
   * this is a typo rather than a layout.
   */
  maxScanDepth: number;
  /** Inject the rules block at all. */
  injectRules: boolean;
}
declare const Config: z<Config>;
/** Cordis entry id; matches `cordis.patch.yml` and stays short by convention. */
declare const name = "rules-manager";
declare const inject: string[];
declare function apply(ctx: Context, config: Config): void;
export { Config, apply, inject, name };