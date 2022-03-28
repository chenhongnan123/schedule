'use strict'
const CONFIG = require('./config/config.json');
const TAGS = require('./tags/tags');
const nodePackage = require('./service/nodepackage.service');
const NodePackage = nodePackage.NodePackage;
NodePackage.server = CONFIG.server;
NodePackage.socketio = CONFIG.socketio;
const bunyan = NodePackage.bunyan;
const UTILITY = require('./utils/utility');
UTILITY.validateConfigfileParameters(CONFIG);
const maintenanceplanJS = require('./src/maintenanceplan');
const andontaskJS = require('./src/andontask');
const sqlpushJS = require('./src/sqlpush');
const sqlpullJS = require('./src/sqlpull');
const authJS = require('./utils/auth');
const auth = authJS.auth(CONFIG, UTILITY);
// const servertimeJS = require('./utils/servertime');
// const servertime = servertimeJS.servertime(CONFIG, UTILITY);
const SOCKETLISTENER = require('./utils/socketlistener');
SOCKETLISTENER.socketlistener(CONFIG).init();
const emitter = SOCKETLISTENER.emitter;
const log = bunyan.createLogger({ name: `index`, level: CONFIG.logger.loglevel });


/**
 * Listen sessionExpired Event and authenticate again
 */
UTILITY.emitter.on('sessionExpired', () => {
  log.info(`Session Expired trying to reAuthenticate`);
  auth.getAuthentication();
})

function initSchedule() {
  const { tasks } = CONFIG;
  const {
    maintenance,
    andon_wechat,
    sql_push,
    sql_pull,
  } = tasks;
  if (maintenance) {
    const MaintenancePlan = maintenanceplanJS.maintenanceplan(CONFIG, UTILITY, TAGS, emitter);
    MaintenancePlan.initEmitter();
    MaintenancePlan.initMaintenancePlan();
  }
  if (andon_wechat) {
    const AndonTask = andontaskJS.andontask(CONFIG, UTILITY, TAGS, emitter);
    AndonTask.initEmitter();
    AndonTask.initAndonTask();
  }
  if (sql_push) {
    // Init Push
    const SqlPush = sqlpushJS.sqlpush(CONFIG, UTILITY, TAGS);
    SqlPush.init();
  }
  if (sql_pull) {
    // Init Pull
    const SqlPull = sqlpullJS.sqlpull(CONFIG, UTILITY)
    SqlPull.init();
  }




}

/**
 * Authenticate E.A. before initialization
 */
authJS.emitter.on('init', () => {
  log.error(`Authentication done successfully`);
  initSchedule();
})

auth.getAuthentication();