import postCss from 'postcss';
import { isAbsolute, join } from 'path';

function loadDiagnostic(context, postcssError, filePath) {
    if (!postcssError || !context) {
        return;
    }
    const level = postcssError.level === 'warning' ? 'warn' : postcssError.level || 'error';
    const diagnostic = {
        level,
        type: 'css',
        language: 'postcss',
        header: `postcss ${level}`,
        code: postcssError.status && postcssError.status.toString(),
        relFilePath: null,
        absFilePath: null,
        messageText: postcssError.reason,
        lines: []
    };
    if (filePath) {
        diagnostic.absFilePath = filePath;
        diagnostic.relFilePath = formatFileName(context.config.rootDir, diagnostic.absFilePath);
        diagnostic.header = formatHeader('postcss', diagnostic.absFilePath, context.config.rootDir, postcssError.line);
        if (postcssError.line > -1) {
            try {
                const sourceText = context.fs.readFileSync(diagnostic.absFilePath);
                const srcLines = sourceText.split(/(\r?\n)/);
                const errorLine = {
                    lineIndex: postcssError.line - 1,
                    lineNumber: postcssError.line,
                    text: srcLines[postcssError.line - 1],
                    errorCharStart: postcssError.column,
                    errorLength: 0
                };
                for (let i = errorLine.errorCharStart; i >= 0; i--) {
                    if (STOP_CHARS.indexOf(errorLine.text.charAt(i)) > -1) {
                        break;
                    }
                    errorLine.errorCharStart = i;
                }
                for (let j = errorLine.errorCharStart; j <= errorLine.text.length; j++) {
                    if (STOP_CHARS.indexOf(errorLine.text.charAt(j)) > -1) {
                        break;
                    }
                    errorLine.errorLength++;
                }
                if (errorLine.errorLength === 0 && errorLine.errorCharStart > 0) {
                    errorLine.errorLength = 1;
                    errorLine.errorCharStart--;
                }
                diagnostic.lines.push(errorLine);
                if (errorLine.lineIndex > 0) {
                    const previousLine = {
                        lineIndex: errorLine.lineIndex - 1,
                        lineNumber: errorLine.lineNumber - 1,
                        text: srcLines[errorLine.lineIndex - 1],
                        errorCharStart: -1,
                        errorLength: -1
                    };
                    diagnostic.lines.unshift(previousLine);
                }
                if (errorLine.lineIndex + 1 < srcLines.length) {
                    const nextLine = {
                        lineIndex: errorLine.lineIndex + 1,
                        lineNumber: errorLine.lineNumber + 1,
                        text: srcLines[errorLine.lineIndex + 1],
                        errorCharStart: -1,
                        errorLength: -1
                    };
                    diagnostic.lines.push(nextLine);
                }
            }
            catch (e) {
                console.error(`StylePostcssPlugin loadDiagnostic, ${e}`);
            }
        }
    }
    context.diagnostics.push(diagnostic);
}
function formatFileName(rootDir, fileName) {
    if (!rootDir || !fileName)
        return '';
    fileName = fileName.replace(rootDir, '');
    if (/\/|\\/.test(fileName.charAt(0))) {
        fileName = fileName.substr(1);
    }
    if (fileName.length > 80) {
        fileName = '...' + fileName.substr(fileName.length - 80);
    }
    return fileName;
}
function formatHeader(type, fileName, rootDir, startLineNumber = null, endLineNumber = null) {
    let header = `${type}: ${formatFileName(rootDir, fileName)}`;
    if (startLineNumber !== null && startLineNumber > 0) {
        if (endLineNumber !== null && endLineNumber > startLineNumber) {
            header += `, lines: ${startLineNumber} - ${endLineNumber}`;
        }
        else {
            header += `, line: ${startLineNumber}`;
        }
    }
    return header;
}
const STOP_CHARS = ['', '\n', '\r', '\t', ' ', ':', ';', ',', '{', '}', '.', '#', '@', '!', '[', ']', '(', ')', '&', '+', '~', '^', '*', '$'];

function usePlugin(fileName) {
    return /(\.css|\.pcss)$/i.test(fileName);
}
function getRenderOptions(opts, sourceText, context) {
    const renderOpts = {
        plugins: opts.plugins || []
    };
    // always set "data" from the source text
    renderOpts.data = sourceText || '';
    const injectGlobalPaths = Array.isArray(opts.injectGlobalPaths) ? opts.injectGlobalPaths.slice() : [];
    if (context && injectGlobalPaths.length > 0) {
        // automatically inject each of these paths into the source text
        const injectText = injectGlobalPaths.map(injectGlobalPath => {
            if (!isAbsolute(injectGlobalPath) && context.config.rootDir) {
                // convert any relative paths to absolute paths relative to the project root
                injectGlobalPath = join(context.config.rootDir, injectGlobalPath);
            }
            return `@import "${injectGlobalPath}";`;
        }).join('');
        renderOpts.data = injectText + renderOpts.data;
    }
    return renderOpts;
}
function createResultsId(fileName) {
    // create what the new path is post transform (.css)
    const pathParts = fileName.split('.');
    pathParts[pathParts.length - 1] = 'css';
    return pathParts.join('.');
}

function postcss(opts = {}) {
    return {
        name: 'postcss',
        pluginType: 'css',
        transform(sourceText, fileName, context) {
            if (!opts.plugins || opts.plugins.length < 1) {
                return null;
            }
            if (!usePlugin(fileName)) {
                return null;
            }
            const renderOpts = getRenderOptions(opts, sourceText, context);
            const results = {
                id: createResultsId(fileName)
            };
            if (sourceText.trim() === '') {
                results.code = '';
                return Promise.resolve(results);
            }
            return new Promise(resolve => {
                postCss(renderOpts.plugins)
                    .process(renderOpts.data || '', {
                    from: fileName
                })
                    .then(postCssResults => {
                    const warnings = postCssResults.warnings();
                    if (warnings.length > 0) {
                        // emit diagnostics for each warning
                        warnings.forEach((warn) => {
                            const err = {
                                reason: warn.text,
                                level: warn.type,
                                column: warn.column || -1,
                                line: warn.line || -1
                            };
                            loadDiagnostic(context, err, fileName);
                        });
                        const mappedWarnings = warnings
                            .map((warn) => {
                            return `${warn.type} ${warn.plugin ? `(${warn.plugin})` : ''}: ${warn.text}`;
                        })
                            .join(', ');
                        results.code = `/**  postcss ${mappedWarnings}  **/`;
                        resolve(results);
                    }
                    else {
                        results.code = postCssResults.css.toString();
                        // write this css content to memory only so it can be referenced
                        // later by other plugins (autoprefixer)
                        // but no need to actually write to disk
                        context.fs.writeFile(results.id, results.code, { inMemoryOnly: true }).then(() => {
                            resolve(results);
                        });
                    }
                    return results;
                })
                    .catch((err) => {
                    loadDiagnostic(context, err, fileName);
                    results.code = `/**  postcss error${err && err.message ? ': ' + err.message : ''}  **/`;
                    resolve(results);
                });
            });
        }
    };
}

export { postcss };
