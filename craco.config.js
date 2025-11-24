const webpack = require('webpack');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Add all Node.js polyfills
      webpackConfig.plugins = [
        ...(webpackConfig.plugins || []),
        new NodePolyfillPlugin(),
        new webpack.DefinePlugin({
          'process.browser': true,
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        }),
        new webpack.ProvidePlugin({
          process: ['process', 'default'],
          Buffer: ['buffer', 'Buffer'],
        }),
      ];

      // Ensure proper resolution for Node.js core modules
      webpackConfig.resolve = {
        ...webpackConfig.resolve,
        fallback: {
          ...webpackConfig.resolve.fallback,
          crypto: require.resolve('crypto-browserify'),
          path: require.resolve('path-browserify'),
          stream: require.resolve('stream-browserify'),
          buffer: require.resolve('buffer/'),
          util: require.resolve('util/'),
          assert: require.resolve('assert/'),
          fs: false,
          net: false,
          tls: false,
          child_process: false,
        },
      };

      return webpackConfig;
    },
  },
};