// A small shell reader for policy checks: quotes, escapes and heredocs only, never a full shell parser.

export const SHELL_INTERPRETER = /^(?:\S*[\\/])?(?:(?:ba|z|da)?sh|pwsh|powershell|cmd)(?:\.exe)?$/i;

// A heredoc body is data (a script for python/node, file content for cat) unless a shell reads it,
// so its lines must not be matched as commands. Bodies fed to a shell are kept and checked.
export function withoutHeredocData(command: string): string {
  return command.replace(
    /^([^\n]*?)<<-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\2([^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/gm,
    (match, head: string, _quote: string, tag: string, rest: string) =>
      SHELL_INTERPRETER.test(head.trim().split(/\s+/)[0] ?? '') ? match : `${head}<<${tag}${rest}`,
  );
}

// Splits on && || ; & | and newlines that sit outside quotes, so `grep -E "a|b"` stays one segment.
export function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      current += char;
      if (char === '\\' && quote === '"' && index + 1 < command.length) current += command[++index];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      current += char + command[++index];
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';' || char === '&' || char === '|' || char === '\n') {
      segments.push(current);
      current = '';
      // && and || are one separator.
      if ((char === '&' || char === '|') && command[index + 1] === char) index += 1;
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.map((segment) => segment.replace(/\r$/, ''));
}

export const SHELL_COMMAND_FLAG = /^(?:-l?c|-command|\/c)$/i;

// The segments plus, for each shell wrapper (`bash -c "git push"`), the segments of its command string,
// which is quoted and so would otherwise read as data.
export function withWrappedCommands(segments: string[]): string[] {
  return segments.flatMap((segment) => {
    const tokens = shellTokens(segment.trim());
    const flag = tokens.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));
    if (!SHELL_INTERPRETER.test(tokens[0] ?? '') || flag < 0) return [segment];
    return [segment, ...withWrappedCommands(splitSegments(tokens.slice(flag + 1).join(' ')))];
  });
}

const SHELL_TOKEN =/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;

export interface ShellWord {
  text: string;
  // A quoted word is data: `grep "git push"` never calls git.
  quoted: boolean;
}

// Words of one segment with their quotes removed; a quoted word is one word even when it holds spaces.
export function shellWords(segment: string): ShellWord[] {
  return [...segment.matchAll(SHELL_TOKEN)].map((token) => ({ text: token[1] ?? token[2] ?? token[3] ?? '', quoted: token[3] === undefined }));
}

export const shellTokens = (segment: string): string[] => shellWords(segment).map((word) => word.text);
