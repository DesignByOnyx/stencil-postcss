import * as postCss from 'postcss';

module.exports = function postcss(
  options: { plugins?: Array<postCss.AcceptedPlugin> } = {}
) {
  return {
    transform: function(sourceText: string, id: string, context: PluginCtx) {
      if (!options.hasOwnProperty('plugins') || options.plugins.length < 1) {
        return null;
      }
      if (!context || !usePlugin(id)) {
        return null;
      }
      const results: PluginTransformResults = {};
      const pathParts = id.split('.');
      pathParts.pop();
      pathParts.push('css');
      results.id = pathParts.join('.');
      if (sourceText.trim() === '') {
        results.code = '';
        return Promise.resolve(results);
      }
      return new Promise<PluginTransformResults>(resolve => {
        postCss(options.plugins)
          .process(sourceText, {
            from: id
          })
          .then(async postCssResults => {
            postCssResults.warnings().forEach(err => {
              loadDiagnostic(context, err, id);
              results.code = `/**  sass error${err.toString()}  **/`;
            });
            results.code = postCssResults.css;
            await context.fs.writeFile(results.id, results.code, {inMemoryOnly: true});
            resolve(results);
          });
      });
    },
    name: 'postCss'
  };
};

function usePlugin(id: string) {
  return /(.scss|.sass|.css)$/i.test(id);
}

function loadDiagnostic(context: PluginCtx, sassError: any, filePath: string) {
  if (!sassError || !context) {
    return;
  }

  const d: Diagnostic = {
    level: 'error',
    type: 'sass',
    language: 'scss',
    header: 'sass error',
    code: sassError.status && sassError.status.toString(),
    relFilePath: null,
    absFilePath: null,
    messageText: sassError.message,
    lines: []
  };

  if (filePath) {
    d.absFilePath = filePath;
    d.relFilePath = formatFileName(context.config.rootDir, d.absFilePath);
    d.header = formatHeader(
      'sass',
      d.absFilePath,
      context.config.rootDir,
      sassError.line
    );

    if (sassError.line > -1) {
      try {
        const sourceText = context.fs.readFileSync(d.absFilePath);
        const srcLines = sourceText.split(/(\r?\n)/);

        const errorLine: PrintLine = {
          lineIndex: sassError.line - 1,
          lineNumber: sassError.line,
          text: srcLines[sassError.line - 1],
          errorCharStart: sassError.column,
          errorLength: 0
        };

        for (let i = errorLine.errorCharStart; i >= 0; i--) {
          if (STOP_CHARS.indexOf(errorLine.text.charAt(i)) > -1) {
            break;
          }
          errorLine.errorCharStart = i;
        }

        for (
          let j = errorLine.errorCharStart;
          j <= errorLine.text.length;
          j++
        ) {
          if (STOP_CHARS.indexOf(errorLine.text.charAt(j)) > -1) {
            break;
          }
          errorLine.errorLength++;
        }

        if (errorLine.errorLength === 0 && errorLine.errorCharStart > 0) {
          errorLine.errorLength = 1;
          errorLine.errorCharStart--;
        }

        d.lines.push(errorLine);

        if (errorLine.lineIndex > 0) {
          const previousLine: PrintLine = {
            lineIndex: errorLine.lineIndex - 1,
            lineNumber: errorLine.lineNumber - 1,
            text: srcLines[errorLine.lineIndex - 1],
            errorCharStart: -1,
            errorLength: -1
          };

          d.lines.unshift(previousLine);
        }

        if (errorLine.lineIndex + 1 < srcLines.length) {
          const nextLine: PrintLine = {
            lineIndex: errorLine.lineIndex + 1,
            lineNumber: errorLine.lineNumber + 1,
            text: srcLines[errorLine.lineIndex + 1],
            errorCharStart: -1,
            errorLength: -1
          };

          d.lines.push(nextLine);
        }
      } catch (e) {
        console.error(`StyleSassPlugin loadDiagnostic, ${e}`);
      }
    }
  }

  context.diagnostics.push(d);
}

function formatFileName(rootDir: string, fileName: string) {
  if (!rootDir || !fileName) return '';

  fileName = fileName.replace(rootDir, '');
  if (/\/|\\/.test(fileName.charAt(0))) {
    fileName = fileName.substr(1);
  }
  if (fileName.length > 80) {
    fileName = '...' + fileName.substr(fileName.length - 80);
  }
  return fileName;
}

function formatHeader(
  type: string,
  fileName: string,
  rootDir: string,
  startLineNumber: number = null,
  endLineNumber: number = null
) {
  let header = `${type}: ${formatFileName(rootDir, fileName)}`;

  if (startLineNumber !== null && startLineNumber > 0) {
    if (endLineNumber !== null && endLineNumber > startLineNumber) {
      header += `, lines: ${startLineNumber} - ${endLineNumber}`;
    } else {
      header += `, line: ${startLineNumber}`;
    }
  }

  return header;
}

const STOP_CHARS = [
  '',
  '\n',
  '\r',
  '\t',
  ' ',
  ':',
  ';',
  ',',
  '{',
  '}',
  '.',
  '#',
  '@',
  '!',
  '[',
  ']',
  '(',
  ')',
  '&',
  '+',
  '~',
  '^',
  '*',
  '$'
];

export interface PluginTransformResults {
  code?: string;
  id?: string;
}

export interface PluginCtx {
  config: {
    rootDir: string;
  };
  fs: any;
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  level: 'error' | 'warn' | 'info' | 'log' | 'debug';
  type: string;
  header?: string;
  messageText: string;
  language?: 'javascript' | 'typescript' | 'scss' | 'css';
  code?: string;
  absFilePath?: string;
  relFilePath?: string;
  lines?: PrintLine[];
}

export interface PrintLine {
  lineIndex: number;
  lineNumber: number;
  text?: string;
  html?: string;
  errorCharStart: number;
  errorLength?: number;
}
