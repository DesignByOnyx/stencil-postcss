import * as d from './declarations';
export declare function postcss(opts?: d.PluginOptions): {
    name: string;
    transform(sourceText: string, fileName: string, context: d.PluginCtx): Promise<d.PluginTransformResults>;
};
