import $ from 'jquery';
import q from 'jquery-ui';
import boostrap from 'bootstrap';

import 'bootstrap/dist/css/bootstrap.min.css';

import '@fortawesome/fontawesome-free/js/fontawesome'
import '@fortawesome/fontawesome-free/js/solid'
import '@fortawesome/fontawesome-free/js/regular'
import '@fortawesome/fontawesome-free/js/brands'

// import { library, dom } from '@fortawesome/fontawesome-svg-core'
// import { fas } from '@fortawesome/free-solid-svg-icons'
// import { far } from '@fortawesome/free-regular-svg-icons'
// import { fab } from '@fortawesome/free-brands-svg-icons'

// library.add(fas, far, fab)

// import Chart from 'chart.js';


require('jquery-ui');
require('jquery-ui/ui/widgets/sortable');
require('jquery-ui/ui/disable-selection');
require('angular');
require('angular-route');

require('chart.js');
require('angular-chart.js');

require('jsondiffpatch/dist/jsondiffpatch.umd');

// require('form-builder');
// require('form-render');
import formBuilder from 'formBuilder';
import formRender from 'formBuilder/dist/form-render.min.js';

require('angular-sanitize');
$('test').formBuilder();
$('test').formRender();
