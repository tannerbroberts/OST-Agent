/**
 * The shell tokenizer the transcript censuses read command lines with.
 *
 * Two censuses now need the same thing out of a recorded `Bash` call: which
 * invocations are inside it, what directory each ran in, and which words were
 * quoted. `search-literality.ts` grew this first for searches over node text;
 * `hand-exclusion.ts` needs it for test-runner invocations. It lives here rather
 * than in either of them so a fix to the quoting rules reaches both, and so a
 * reader that refuses a command refuses it identically on both sides.
 *
 * It is deliberately not a shell. It splits and unquotes; it does not expand.
 * Anything whose text depends on evaluation — `$(…)`, a backtick, `${…}`, a
 * process substitution — is refused by {@link SHELL_UNREADABLE} rather than
 * guessed at, because a census that guesses is a census that reports its own
 * guess as a finding.
 */

/** The unquoted operators that end one command and begin another. */
export const SHELL_OPERATORS = ["||", "&&", "|", ";", "&", "\n", ">>", ">", "<"];

/** Words that start a fresh command segment the same way an operator does. */
export const SHELL_GROUPING = ["(", ")", "{", "}"];

/**
 * Split a shell command into words, or refuse it. Quoting is preserved as data,
 * and an operator is its own word whether or not spaces were typed around it —
 * `ls|grep x` is two commands, and a reader that missed that would hand `grep`'s
 * flags to `ls`.
 */
export function shellWords(command: string): { words: string[]; quoted: boolean[] } | null {
  const words: string[] = [];
  const quoted: boolean[] = [];
  let current = "";
  let started = false;
  let wasQuoted = false;
  let quote: '"' | "'" | null = null;

  const flush = () => {
    if (!started) return;
    words.push(current);
    quoted.push(wasQuoted);
    current = "";
    started = false;
    wasQuoted = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      // Inside double quotes a backslash escapes only these four; before anything
      // else it is a backslash, and `"\|"` reaching grep as `\|` is the difference
      // between an alternation and a literal pipe.
      if (ch === "\\" && quote === '"' && '$`"\\'.includes(command[i + 1] ?? "")) {
        current += command[++i];
        started = true;
        continue;
      }
      current += ch;
      started = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      wasQuoted = true;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      current += command[++i];
      started = true;
      continue;
    }
    if (/\s/.test(ch) && ch !== "\n") {
      flush();
      continue;
    }
    const operator = SHELL_OPERATORS.find((op) => command.startsWith(op, i));
    if (operator) {
      flush();
      words.push(operator);
      quoted.push(false);
      i += operator.length - 1;
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) return null; // unbalanced quoting: this module will not guess
  flush();
  return { words, quoted };
}

/** Commands whose text this module refuses to read as a fixed argument. */
export const SHELL_UNREADABLE = /\$\(|`|\$\{|<\(/;
