import * as path from 'path';
import * as fs from 'fs';
import { camelCase } from 'lodash';
import { Configuration, ProgressPlugin, DefinePlugin } from 'webpack';
import Config from 'webpack-chain';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import pxToUnits from '@remax/postcss-px2units';
import { RemaxOptions } from 'remax-types';
import { Platform } from '../build/platform';
import extensions, { matcher } from '../extensions';
import getEntries from '../getEntries';
import * as styleConfig from '../build/styleConfig';
import app from '../build/plugins/app';
import page from '../build/plugins/page';
// import fixRegeneratorRuntime from './plugins/fixRegeneratorRuntime';
import nativeComponentsBabelPlugin from '../build/plugins/nativeComponents/babelPlugin';
import components from '../build/plugins/components';
import * as RemaxPlugins from '../build/webpack/plugins';
import alias from '../build/alias';
import getEnvironment from '../build/env';

const config = new Config();

function useLoader(id: string) {
  try {
    const loaderPath = path.join(__dirname, './webpack/loaders', camelCase(id) + '.js');
    if (fs.existsSync(loaderPath)) {
      return loaderPath;
    }
  } catch {
    // ignore
  }

  return require.resolve(id + '-loader');
}

function prepare(options: RemaxOptions, target: Platform) {
  const entries = getEntries(options);
  const entryMap = [entries.app, ...entries.pages].reduce<any>((m, entry) => {
    const ext = path.extname(entry);
    const name = entry.replace(path.join(options.cwd, options.rootDir) + '/', '').replace(new RegExp(`${ext}$`), '');
    m[name] = entry;
    return m;
  }, {});
  const env = getEnvironment(options, target);

  return {
    entries,
    entryMap,
    env,
  };
}

export default function webpackConfig(options: RemaxOptions, target: Platform): Configuration {
  const { entries, entryMap, env } = prepare(options, target);

  config.entry('index').add('src/index.js');

  config.devtool(process.env.NODE_ENV === 'development' ? 'cheap-module-source-map' : false);
  config.mode((process.env.NODE_ENV as any) || 'development');
  config.context(options.cwd);
  config.resolve.extensions.merge(extensions);
  config.resolve.alias.merge(alias(options));
  config.output.path(path.join(options.cwd, options.output));
  config.output.filename('[name].js');

  config.module
    .rule('createAppOrPageConfig')
    .test(matcher)
    .include.add(entries.app)
    .merge(entries.pages)
    .end()
    .use('babel')
    .loader(useLoader('babel'))
    .options({
      usePlugins: [app(entries.app), page(entries.pages)],
      reactPreset: false,
    });

  config.module
    .rule('compilation')
    .test(matcher)
    .use('babel')
    .loader(useLoader('babel'))
    .options({
      usePlugins: [
        nativeComponentsBabelPlugin(options),
        components(options),
        // fixRegeneratorRuntime
      ],
      reactPreset: true,
    });

  const cssModuleConfig = styleConfig.getCssModuleConfig(options.cssModules);
  const preprocessCssRules = [
    {
      name: 'postcss',
      loader: useLoader('postcss'),
      options: {
        config: {
          path: styleConfig.resolvePostcssConfig(options),
        },
        plugins: [pxToUnits()].filter(Boolean),
      },
    },
    styleConfig.enabled('less') && { name: 'less', loader: useLoader('less') },
    styleConfig.enabled('node-sass') && { name: 'sass', loader: useLoader('sass') },
    styleConfig.enabled('stylus') && { name: 'stylus', loader: useLoader('stylus') },
  ].filter(Boolean) as any[];

  let stylesRule = config.module
    .rule('styles')
    .test(/\.(css|less|sass|stylus)$/i)
    .exclude.add(cssModuleConfig.enabled ? cssModuleConfig.regExp : '')
    .end()
    .use('cssExtract')
    .loader(MiniCssExtractPlugin.loader)
    .end()
    .use('css')
    .loader(useLoader('css'))
    .options({
      importLoaders: preprocessCssRules.length,
    })
    .end();

  preprocessCssRules.forEach(rule => {
    stylesRule = stylesRule
      .use(rule.name)
      .loader(rule.loader)
      .options(rule.options || {})
      .end();
  });

  // Css Modules
  if (cssModuleConfig.enabled) {
    stylesRule = config.module
      .rule('cssModulesStyles')
      .test(cssModuleConfig.regExp)
      .include.add(cssModuleConfig.regExp)
      .end()
      .use(MiniCssExtractPlugin.loader)
      .loader(MiniCssExtractPlugin.loader)
      .end()
      .use('css')
      .loader(useLoader('css'))
      .options({
        importLoaders: preprocessCssRules.length,
        modules: true,
      })
      .end();

    preprocessCssRules.forEach(rule => {
      stylesRule = stylesRule
        .use(rule.name)
        .loader(rule.loader)
        .options(rule.options || {})
        .end();
    });
  }

  config.module
    .rule('json')
    .test(/\.json$/)
    .use('json')
    .loader(useLoader('json'));

  config.module
    .rule('remaxDefineVariables')
    .test(/remax\/esm\/createHostComponent.js/i)
    .use('remax-define')
    .loader(useLoader('remax-define'));

  config.module
    .rule('images')
    .test(/\.(png|jpe?g|gif|svg)$/i)
    .use('file')
    .loader(useLoader('file'));

  config.module
    .rule('resolvePlatformFiles')
    .test(matcher)
    .use('resolve-platform')
    .loader(useLoader('resolve-platform'));

  config.plugin('virtualModule').use(VirtualModulePlugin, [
    {
      moduleName: 'src/index.js',
      contents: JSON.stringify({ greeting: 'Hello!' }),
    },
  ]);

  if (options.progress) {
    config.plugin('progress').use(new ProgressPlugin());
  }

  config.plugin('define').use(new DefinePlugin(env.stringified));
  config.plugin('cssExtract').use(
    new MiniCssExtractPlugin({
      filename: `[name]`,
    })
  );
  config.plugin('optimizeEntries').use(new RemaxPlugins.OptimizeEntries(meta));
  config.plugin('nativeFiles').use(new RemaxPlugins.NativeFiles(options));

  if (process.env.NODE_ENV === 'production') {
    config.plugin('clean').use(new CleanWebpackPlugin() as any);
  }

  if (typeof options.configWebpack === 'function') {
    options.configWebpack(config);
  }

  console.log(config.toConfig());

  return config.toConfig();
}
