const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const WebpackChunkHash = require('webpack-chunk-hash');
const HtmlWebpackIncludeAssetsPlugin = require('html-webpack-include-assets-plugin');
const SWPrecacheWebpackPlugin = require('sw-precache-webpack-plugin');
const SwRegisterWebpackPlugin = require('sw-register-webpack-plugin');

const {
  getHTML,
  getStyleWithImageLoaderConfig,
  getOtherFileLoaderConfig,
  HtmlLoaderConfig,
  getSVGLoaderConfig,
  getJsLoader,
} = require('./util');


const WORK_DIR = process.cwd();
const SOURCE_PATH = path.resolve(WORK_DIR, './src');
const MODULES_PATH = path.resolve(__dirname, '../node_modules');
const APP_PATH = path.join(SOURCE_PATH, './app');

const DEFAULT_PROJECT_CONFIG = require('./project.config');

/**
 * 标准化项目输出配置
 * @{param} env: 'development' or 'production' 指定开发环境或生产环境
 */
module.exports = (env = 'development', options) => {

  // 开发环境
  const IS_DEV = env === 'development';

  // 应用输出页面
  const AppPages = getHTML(APP_PATH);

  const PROJECT_CONFIG = Object.assign(
    DEFAULT_PROJECT_CONFIG,
    require(path.resolve(WORK_DIR, './abc.json'))
  );
  const EXTERNALS = PROJECT_CONFIG.externals;

  // refer to: https://github.com/ai/browserslist#queries
  const BROWSER_SUPPORTS = PROJECT_CONFIG.browser_support[env.toUpperCase()];
  const BUILD_PATH = path.resolve(WORK_DIR, PROJECT_CONFIG.build_path);

  // 入口配置
  const entryConfig = {};
  // 插件配置
  let pluginsConfig = [
    new webpack.optimize.ModuleConcatenationPlugin(),
    new webpack.optimize.MinChunkSizePlugin({ minChunkSize: 50000 }),
  ];
  if (IS_DEV) {
    pluginsConfig.push(
      new webpack.NamedModulesPlugin(),
      new webpack.HotModuleReplacementPlugin()
    );
  } else {
    pluginsConfig.push(
      new webpack.HashedModuleIdsPlugin(),
      new WebpackChunkHash()
    );
  }

  const OutputConfig = {
    path: BUILD_PATH,
    pathinfo: IS_DEV,
  };
  if (!IS_DEV) {
    // 生产环境 资源名加上 hash
    Object.assign(OutputConfig, {
      filename: '[name].[chunkhash:8].js',
    });
  }

  // libiary 输出配置
  const LibiaryList = Object.keys(PROJECT_CONFIG.libiary);
  const LibiaryEntry = {};
  LibiaryList.forEach(name => {
    LibiaryEntry[`assets/${name}`] = PROJECT_CONFIG.libiary[name].map(file => path.resolve(SOURCE_PATH, file));
  });

  AppPages.forEach(appPage => {
    const pageName = appPage.replace(/\.html?$/, '');
    entryConfig[pageName] = [
      path.join(SOURCE_PATH, `app/${pageName}.js`),
    ];
    if (IS_DEV) {
      if (PROJECT_CONFIG.enableReactHotLoader && PROJECT_CONFIG.framework === 'react') {
        entryConfig[pageName].unshift(
          'react-hot-loader/patch',
          path.join(MODULES_PATH, 'webpack-dev-server/client') + `?http://localhost:${options.port}`,
          path.join(MODULES_PATH, 'webpack/hot/dev-server')
        );
      } else {
        entryConfig[pageName].unshift(
          path.join(MODULES_PATH, 'webpack-dev-server/client') + `?http://localhost:${options.port}`,
          path.join(MODULES_PATH, 'webpack/hot/dev-server')
        );
      }
    }
    pluginsConfig.push(
      new HtmlWebpackPlugin({
        filename: appPage,
        template: path.join(APP_PATH, appPage),
        inject: PROJECT_CONFIG.htmlAssetsInject,
        chunksSortMode: 'auto',
        chunks: [
          LibiaryList.map(name => `assets/${name}`),
          'assets/commonLibs',
          pageName,
        ],
        minify: IS_DEV ? false : {
          removeComments: true,
          collapseWhitespace: true,
          removeRedundantAttributes: true,
          useShortDoctype: true,
          removeEmptyAttributes: false,
          removeStyleLinkTypeAttributes: true,
          keepClosingSlash: true,
          minifyJS: true,
          minifyCSS: true,
          minifyURLs: true,
        },
      })
    );
  });

  // 公共模块配置
  const LibiaryChunks = LibiaryList.map(
    name => new webpack.optimize.CommonsChunkPlugin({
      name: `assets/${name}`,
      chunks: [`assets/${name}`],
      minChunks: Infinity,
    })
  );
  LibiaryChunks.push(
    new webpack.optimize.CommonsChunkPlugin({
      name: 'assets/commonLibs',
      chunks: Object.keys(entryConfig),
    })
  );

  // css & image 解析配置
  const {
    StyleLoaderConfig,
    ImageLoaderConfig,
    ExtractCssPlugin,
  } = getStyleWithImageLoaderConfig(IS_DEV, BROWSER_SUPPORTS, PROJECT_CONFIG.publicPath, PROJECT_CONFIG.base64);

  if (ExtractCssPlugin) {
    pluginsConfig.push(ExtractCssPlugin);
  }


  // 外部资源配置，这里配置后不通过构建
  const ExternalsConfig = {};
  const ExternalsCopyList = [];
  const ExternalsBuildList = [];
  Object.keys(EXTERNALS).forEach(name => {
    if (EXTERNALS[name].alias) {
      ExternalsConfig[name] = EXTERNALS[name].alias;
    }
    if (EXTERNALS[name].path) {
      ExternalsCopyList.push({
        from: path.join(WORK_DIR, EXTERNALS[name].path),
        to: path.join(BUILD_PATH, 'assets'),
      });
      ExternalsBuildList.push(path.join('assets', path.basename(EXTERNALS[name].path)));
    }
  });
  // 复制 external 资源到输出目录
  pluginsConfig.push(new CopyWebpackPlugin(ExternalsCopyList));
  // html 中 external 的资源需要手动加入
  const IncludeAssetsConfig = new HtmlWebpackIncludeAssetsPlugin({
    assets: ExternalsBuildList,
    append: false,
  });

  pluginsConfig = [
    ...pluginsConfig,
    IncludeAssetsConfig,
    ...LibiaryChunks,
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.DEBUG': JSON.stringify(process.env.DEBUG)
    }),
  ];

  // sw-precache-webpack-plugin configurations
  const SERVICE_CONFIG = Object.assign({}, 
    require('./project.config').serviceWorkConf, 
    require(path.resolve(WORK_DIR, './abc.json')).serviceWorkConf
  );
  const {
    enable: SERVICE_WORKER_ENABLE,
    staticFileGlobsIgnorePatterns: ignoreArry,
    prefix: SERVICE_WORKER_PREFIX,
    ...SW_PRECACHE_CONFIG
  } = SERVICE_CONFIG;

  if (SERVICE_WORKER_ENABLE) {
    let ignorePatternsArry = [];

    ignoreArry.map(item => {
      ignorePatternsArry.push(new RegExp(item));
    });
    pluginsConfig = [
      ... pluginsConfig,
      new SWPrecacheWebpackPlugin({
        ...SW_PRECACHE_CONFIG,
        staticFileGlobsIgnorePatterns: ignorePatternsArry,
      }),
      new SwRegisterWebpackPlugin({
        filePath: './sw-register.js',
        prefix: SERVICE_WORKER_PREFIX
      })
    ];
  }

  return {
    entry: Object.assign(entryConfig, LibiaryEntry),

    output: OutputConfig,

    module: {
      rules: [
        getJsLoader(PROJECT_CONFIG, MODULES_PATH, BROWSER_SUPPORTS),
        StyleLoaderConfig,
        ImageLoaderConfig,
        HtmlLoaderConfig,
        getOtherFileLoaderConfig(PROJECT_CONFIG),
      ].concat(getSVGLoaderConfig(PROJECT_CONFIG, MODULES_PATH, BROWSER_SUPPORTS))
    },

    externals: ExternalsConfig,

    // resolve: {
    //   modules: [
    //     'node_modules',
    //     MODULES_PATH,
    //   ]
    // },

    target: 'web',

    devtool: IS_DEV ? 'cheap-module-source-map': 'source-map',

    resolveLoader: {
      modules: [ MODULES_PATH ],
    },

    plugins: pluginsConfig,
  };

};