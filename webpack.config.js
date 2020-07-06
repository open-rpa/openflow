var webpack = require('webpack');
const path = require('path');

module.exports = {
    mode: "production",
    entry: './OpenFlow/src/public/index.js',
    performance: { hints: false },
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist/public')
    },
    // externals: {
    //     jquery: 'jQuery'
    // },

    plugins: [
        new webpack.ProvidePlugin({
            Dropdown: "exports-loader?Dropdown!bootstrap/js/dist/dropdown",
        }),
        new webpack.ProvidePlugin({
            // $: "./jquery-3.3.1",
            // jQuery: "./jquery-3.3.1",
            // "window.jQuery": './jquery-3.3.1',
        }),
    ],
    module: {
        rules: [
            {
                test: require.resolve('jquery'),
                loader: 'expose-loader',
                options: {
                    exposes: ['jQuery', '$'],
                }
                // use: [{
                //     loader: 'expose-loader',
                //     options: 'jQuery'
                // }, {
                //     loader: 'expose-loader',
                //     options: '$'
                // }]
            },
            {
                test: require.resolve('jsondiffpatch/dist/jsondiffpatch.umd'),
                loader: 'expose-loader',
                options: {
                    exposes: 'jsondiffpatch',
                }
            },
            // {
            //     test: require.resolve('jsondiffpatch/dist/jsondiffpatch.umd'),
            //     use: [{
            //         loader: 'expose-loader',
            //         options: 'jsondiffpatch'
            //     }]
            // },
            // {
            //     test: require.resolve('formBuilder'),
            //     use: [{
            //         loader: 'expose-loader',
            //         options: 'formBuilder'
            //     }]
            // },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            { test: /\.handlebars$/, loader: "handlebars-loader" }
        ]
    },
    // resolve: {
    //     alias: {
    //         'angular-chart': ' ../angular-chart.js' // should not be required if you installed with npm
    //     }
    // }
    // resolve: {
    //     alias: {
    //         'chart.js': require.resolve('angular-chart'),
    //     }
    // }

    // alias: {
    //     jquery: 'jquery/src/jquery',
    //     'jquery-ui': 'jquery-ui/ui',
    // },

    // resolve: {
    //     alias: {
    //         // jquery: 'jquery/src/jquery',
    //         'jquery-ui': 'jquery-ui/ui',
    //     },
    // },
};