const path = require('path');
const webpack = require('webpack');
const NodemonPlugin = require('nodemon-webpack-plugin');
const FilterWarningsPlugin = require('webpack-filter-warnings-plugin');

module.exports = {
  entry: './src/index.ts',
  target: 'node',
  externals: {
    express: 'require("express")',
    'app-root-path': 'require("app-root-path")',
    keyv: 'require("keyv")',
    'sync-rpc': 'require("sync-rpc")',
    typeorm: 'require("typeorm")',
  },
  devtool: 'inline-source-map',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
  },
  resolve: {
    extensions: ['.ts', '.js', 'json'],
  },
  module: {
    rules: [
      {
        loader: 'ts-loader',
        test: /\.ts?$/,
        include: path.resolve(__dirname, 'src'),
      },
    ],
  },
  mode: 'development',
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^pg-native$/ }),
    new NodemonPlugin(),
    new FilterWarningsPlugin({
      exclude: [/mongodb/, /mssql/, /mysql/, /mysql2/, /oracledb/, /redis/, /sqlite3/, /sql.js/, /react-native-sqlite-storage/, /typeorm-aurora-data-api-driver/, /@sap\/hdbext/, /pg-query-stream/],
    }),
  ],
};
