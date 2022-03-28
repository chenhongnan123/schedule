const nodePackage = require('../service/nodepackage.service');
const NodePackage = nodePackage.NodePackage;
const _ = NodePackage.lodash;
const bunyan = NodePackage.bunyan;
const moment = NodePackage.moment;
const EventEmitter = NodePackage.EventEmitter;
const emitter = new EventEmitter.EventEmitter();
const log = bunyan.createLogger({ name: 'utility', level: 20 })
/** @constant {Object} */
const DATA_TYPE = {
    STRING: "string",
    NUMBER: "number",
    BOOLEAN: "boolean",
    OBJECT: "object"
};

/** @constant {Object} */
const HTTP_STATUS_CODE = {
    SUCCESS: 200,
    ACCEPTED: 202,
    BAD_REQUEST: 406,
    NOT_ACCEPTABLE: 406,
    INTERNAL_SERVER_ERROR: 500
}
let requestTimeout = {
    timeout: 45 * 1000
}
/**
 * Efficiently calculates the comma separated string
 * passed into the method. The input is expected in below format,
 * 
 * concat("This","is","an","example") return "Thisisanexample"
 *
 * @param {string} strings comma separated strings.
 */
const concat = (...strings) => {
    return _.reduce(strings, (accumulator, currentItem) => {
        return accumulator + currentItem;
    });
};

/**
 * Checks if give configuration parameter exists with given data types. If no then exit node js service 
 * pointing deficiency in perticular parameter.
 * 
 * @param {string} configParam 
 * @param {string} dataType 
 */
const checkIfExists = (configParam, configParamString, dataType) => {
    // check if configuration parameter exists in configuration file.
    if (typeof configParam != 'boolean' && !configParam) {
        log.fatal("Configuration parameter is invalid OR absent: " + configParamString);
        process.exit(1);
    }
    // check if configuration parameter has valid data type.
    if (typeof configParam != dataType) {
        log.fatal("Data type for configuration parameter '" + configParamString + "' must be: " + dataType);
        process.exit(1);
    }
}
/**
 * validate the configuration parameter is valid with given conditions
 * 
 */
const validateConfigfileParameters = (CONFIG) => {

    log.info('Validating Configuration file.');

    checkIfExists(CONFIG.industryid, "CONFIG.industryid", DATA_TYPE.NUMBER);
    checkIfExists(CONFIG.loginType, "CONFIG.loginType", DATA_TYPE.STRING);

    checkIfExists(CONFIG.server, "CONFIG.server", DATA_TYPE.OBJECT);
    checkIfExists(CONFIG.server.protocol, "CONFIG.server.protocol", DATA_TYPE.STRING);
    checkIfExists(CONFIG.server.host, "CONFIG.server.host", DATA_TYPE.STRING);
    checkIfExists(CONFIG.server.port, "CONFIG.server.port", DATA_TYPE.NUMBER);

    checkIfExists(CONFIG.socketio, "CONFIG.socketio", DATA_TYPE.OBJECT);
    checkIfExists(CONFIG.socketio.host, "CONFIG.socketio.host", DATA_TYPE.STRING);
    checkIfExists(CONFIG.socketio.port, "CONFIG.socketio.port", DATA_TYPE.NUMBER);
    // checkIfExists(CONFIG.socketio.namespace, "CONFIG.socketio.namespace", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.socketio.eventname, "CONFIG.socketio.eventname", DATA_TYPE.STRING);

    checkIfExists(CONFIG.credential, "CONFIG.credential", DATA_TYPE.OBJECT);
    checkIfExists(CONFIG.credential.password, "CONFIG.credential.password", DATA_TYPE.STRING);
    checkIfExists(CONFIG.credential.identifier, "CONFIG.credential.identifier", DATA_TYPE.STRING);

    // checkIfExists(CONFIG.kafkaEdge, "CONFIG.kafkaEdge", DATA_TYPE.OBJECT);
    // checkIfExists(CONFIG.kafkaEdge.host, "CONFIG.kafkaEdge.host", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.kafkaEdge.port, "CONFIG.kafkaEdge.port", DATA_TYPE.NUMBER);
    // checkIfExists(CONFIG.kafkaEdge.autoCommit, "CONFIG.kafkaEdge.autoCommit", DATA_TYPE.BOOLEAN);
    // checkIfExists(CONFIG.kafkaEdge.fetchMinBytes, "CONFIG.kafkaEdge.fetchMinBytes", DATA_TYPE.NUMBER);
    // checkIfExists(CONFIG.kafkaEdge.fetchMaxBytes, "CONFIG.kafkaEdge.fetchMaxBytes", DATA_TYPE.NUMBER);

    checkIfExists(CONFIG.logger, "CONFIG.logger", DATA_TYPE.OBJECT);
    checkIfExists(CONFIG.logger.loglevel, "CONFIG.logger.loglevel", DATA_TYPE.NUMBER);

    checkIfExists(CONFIG.elements, "CONFIG.elements", DATA_TYPE.OBJECT);
    checkIfExists(CONFIG.elements.machine, "CONFIG.elements.machine", DATA_TYPE.STRING);
    checkIfExists(CONFIG.elements.maintenanceplan, "CONFIG.elements.maintenanceplan", DATA_TYPE.STRING);
    checkIfExists(CONFIG.elements.maintenancetask, "CONFIG.elements.maintenancetask", DATA_TYPE.STRING);

    // checkIfExists(CONFIG.elements.substation, "CONFIG.elements.substation", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.order, "CONFIG.elements.order", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.orderproduct, "CONFIG.elements.orderproduct", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.orderrecipe, "CONFIG.elements.orderrecipe", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.orderroadmap, "CONFIG.elements.orderroadmap", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.checkin, "CONFIG.elements.checkin", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.checkout, "CONFIG.elements.checkout", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.component, "CONFIG.elements.component", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.partstatus, "CONFIG.elements.partstatus", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.rework, "CONFIG.elements.rework", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.bomdetails, "CONFIG.elements.bomdetails", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.componentcheck, "CONFIG.elements.componentcheck", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.productionimage, "CONFIG.elements.productionimage", DATA_TYPE.STRING);
    // checkIfExists(CONFIG.elements.productionimageinfo, "CONFIG.elements.productionimageinfo", DATA_TYPE.STRING);

    checkIfExists(CONFIG.defaults, "CONFIG.defaults", DATA_TYPE.OBJECT);
    // checkIfExists(CONFIG.defaults.isPreviousDataIgnored, "CONFIG.defaults.isPreviousDataIgnored", DATA_TYPE.BOOLEAN);

    // checkIfExists(CONFIG.status, "CONFIG.status", DATA_TYPE.OBJECT);
    // checkIfExists(CONFIG.status.running, "CONFIG.status.running", DATA_TYPE.STRING);

    log.info('Configuration file successfully validated.');

};

const validateSqlPushConfigParameters = (CONFIG) => {

    log.info('Validating sqlpush.json file.');

    checkIfExists(CONFIG.dbConnectors, "CONFIG.dbConnectors", DATA_TYPE.OBJECT);
    let dbConnectorslength = Object.keys(CONFIG.dbConnectors).length;
    for (let i = 0; i < dbConnectorslength; i++) {
        let dbConnectors = CONFIG.dbConnectors[i];
        checkIfExists(dbConnectors.dbConnectorName, "CONFIG.dbConnectors.dbConnectorName", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props, "CONFIG.dbConnector.props", DATA_TYPE.OBJECT);
        checkIfExists(dbConnectors.props.database, "CONFIG.dbConnectors.props.database", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.username, "CONFIG.dbConnectors.props.username", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.password, "CONFIG.dbConnectors.props.password", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.hostname, "CONFIG.dbConnectors.props.hostname", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.dialect, "CONFIG.dbConnectors.props.dialect", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.port, "CONFIG.dbConnectors.props.port", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.connectionTimeout, "CONFIG.dbConnectors.props.connectionTimeout", DATA_TYPE.NUMBER);
        checkIfExists(dbConnectors.props.requestTimeout, "CONFIG.dbConnectors.props.requestTimeout", DATA_TYPE.NUMBER);
        checkIfExists(dbConnectors.props.pool, "CONFIG.dbConnectors.props.pool", DATA_TYPE.OBJECT);
        checkIfExists(dbConnectors.props.pool.idleTimeoutMillis, "dbConnectors.props.pool.idleTimeoutMillis", DATA_TYPE.NUMBER);
        checkIfExists(dbConnectors.props.pool.max, "CONFIG.dbConnectors.props.pool.max", DATA_TYPE.NUMBER);
    }
    checkIfExists(CONFIG.schemaSWXPush, "CONFIG.schemaSWXPush", DATA_TYPE.OBJECT);

    log.info('Configuration file successfully validated.');
    let schemalength = Object.keys(CONFIG.schemaSWXPush).length;
    for (let i = 0; i < schemalength; i++) {
        let schema = CONFIG.schemaSWXPush[i];
        checkIfExists(schema.cron, "CONFIG.schemaSWXPush.cron", DATA_TYPE.STRING);
        checkIfExists(schema.limit, "CONFIG.schemaSWXPush.limit", DATA_TYPE.NUMBER);
        checkIfExists(schema.tableName, "CONFIG.schemaSWXPush.tableName", DATA_TYPE.STRING);
        checkIfExists(schema.elementName, "CONFIG.schemaSWXPush.elementName", DATA_TYPE.STRING);
        // checkIfExists(schema.id, "CONFIG.schemaSWXPush.id", DATA_TYPE.STRING);
        checkIfExists(schema.mappings, "CONFIG.schemaSWXPush.mappings", DATA_TYPE.OBJECT);
        // checkIfExists(schema.defaultMappings, "CONFIG.schemaSWXPush.defaultMappings", DATA_TYPE.OBJECT);
        checkIfExists(schema.schema, "CONFIG.schemaSWXPush.schema", DATA_TYPE.OBJECT);
        checkIfExists(schema.removeFromPayload, "CONFIG.schemaSWXPush.removeFromPayload", DATA_TYPE.OBJECT);
        checkIfExists(schema.lagLimit, "CONFIG.schemaSWXPush.lagLimit", DATA_TYPE.NUMBER);
        checkIfExists(schema.waitBeforeInsert, "CONFIG.schemaSWXPush.waitBeforeInsert", DATA_TYPE.NUMBER);
        if (schema.waitBeforeInsert < 0) {
            log.fatal("waitBeforeInsert must be greater or equal to Zerofor for element name: '" + schema.elementName + "'");
            process.exit(1);
        }
        checkIfExists(schema.isInsertOnLimitMatch, "CONFIG.schemaSWXPush.isInsertOnLimitMatch", DATA_TYPE.BOOLEAN);
    }
};

const validateSqlPullConfigParameters = (CONFIG) => {

    log.info('Validating sqlpull.json file.');

    checkIfExists(CONFIG.dbConnectors, "CONFIG.dbConnectors", DATA_TYPE.OBJECT);
    let dbConnectorslength = Object.keys(CONFIG.dbConnectors).length;
    for (let i = 0; i < dbConnectorslength; i++) {
        let dbConnectors = CONFIG.dbConnectors[i];
        checkIfExists(dbConnectors.dbConnectorName, "CONFIG.dbConnectors.dbConnectorName", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props, "CONFIG.dbConnector.props", DATA_TYPE.OBJECT);
        checkIfExists(dbConnectors.props.database, "CONFIG.dbConnectors.props.database", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.username, "CONFIG.dbConnectors.props.username", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.password, "CONFIG.dbConnectors.props.password", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.hostname, "CONFIG.dbConnectors.props.hostname", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.dialect, "CONFIG.dbConnectors.props.dialect", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.port, "CONFIG.dbConnectors.props.port", DATA_TYPE.STRING);
        checkIfExists(dbConnectors.props.connectionTimeout, "CONFIG.dbConnectors.props.connectionTimeout", DATA_TYPE.NUMBER);
        checkIfExists(dbConnectors.props.requestTimeout, "CONFIG.dbConnectors.props.requestTimeout", DATA_TYPE.NUMBER);
        checkIfExists(dbConnectors.props.pool, "CONFIG.dbConnectors.props.pool", DATA_TYPE.OBJECT);
        checkIfExists(dbConnectors.props.pool.idleTimeoutMillis, "dbConnectors.props.pool.idleTimeoutMillis", DATA_TYPE.NUMBER);
        checkIfExists(dbConnectors.props.pool.max, "CONFIG.dbConnectors.props.pool.max", DATA_TYPE.NUMBER);
    }
     checkIfExists(CONFIG.schemaSWXPull, "CONFIG.schemaSWXPull", DATA_TYPE.OBJECT);

    log.info('Configuration file successfully validated.');
    let schemalength = Object.keys(CONFIG.schemaSWXPull).length;
    for (let i = 0; i < schemalength; i++) {
        let schema = CONFIG.schemaSWXPull[i];

        checkIfExists(schema.tableName, "CONFIG.schemaSWXPull.tableName", DATA_TYPE.STRING);

        // checkIfExists(schema.id, "CONFIG.schemaSWXPull.id", DATA_TYPE.STRING);
        checkIfExists(schema.mappings, "CONFIG.schemaSWXPull.mappings", DATA_TYPE.OBJECT);
        checkIfExists(schema.schema, "CONFIG.schemaSWXPull.schema", DATA_TYPE.OBJECT);
        checkIfExists(schema.kafka, "CONFIG.schemaSWXPull.kafka", DATA_TYPE.OBJECT);
       
    }
};
/**
 * Throw Error.
 * 
 * @param {object} reply 
 * @param {object} err 
 */
const throwError = (reply, err) => {
    reply.code(500).send({ message: err });
}

/**
 * This function map the data with element schema
 * @param {object} data which contains actual data to log
 * @param {object} fields which contains schema of elements
 */
const assignDataToSchema = function (data, fields) {
    let postData = {};
    // log.info(" Map values with element schema ");
    // map values with element schmea
    // if prefix required for any element need to pass it to function as a param
    let prefix = '';
    if (fields.length > 0) {
        for (let i = 0; fields && i < fields.length; i++) {
            let tagname = prefix + fields[i].tagName;
            let choice = fields[i].emgTagType || '';
            switch (choice) {
                case "Int": case "Double": case "Float": case "Long":
                    if (data[tagname] || data[tagname] === 0) {
                        postData[fields[i].tagName] = (data[tagname] || data[tagname] === 0) ? +data[tagname] : data[tagname];
                    }
                    break;
                case "String":
                    if (data[tagname] || data[tagname] === '') {
                        let stringValue = data[tagname] ? data[tagname].toString() : data[tagname];
                        stringValue = stringValue ? stringValue.replace(/\u0000/g, '') : stringValue;
                        postData[fields[i].tagName] = stringValue ? stringValue.trim() : stringValue;
                    }
                    break;
                case "Boolean":
                    postData[fields[i].tagName] = data[tagname] || false;
                    break;
                default:
                    if (data[tagname] || data[tagname] == 0) {
                        postData[fields[i].tagName] = data[tagname];
                    }
            }
        }
    } else {
        postData = data;
    }
    return postData;
}
const checkSessionExpired = (data) => {
    if (data && data.errors && data.errors.errorCode === 'INVALID_SESSION') {
        log.error(`Session Id expired ${JSON.stringify(data.errors)}`);
        emitter.emit('sessionExpired');
    }
}

const arrayUniqueByKey = (data, key) => {
    const unique = [...new Map(data.map(item =>
        [item[key], item])).values()];
    return unique;
}

const cloneDeep = (data) => {
    return JSON.parse(JSON.stringify(data))
}

/**
 * When any API failed or need to wait before calling next function or step use this function
 * @param {Number} time Refer for adding delay time
 */
async function setTimer(time) {
    time = time || 1; // default time is 1 seconds if time not passed from function
    await new Promise(resolve => setTimeout(resolve, time * 1000));
}

const drawLine = () => {
    log.info('-----------------------------------------------------------------------------------');
}
/**
 * Get a valid date format.
 * This always returns a valid date. In absence of values it uses current date.
 * 
 * @param {boolean} isUTC 
 * @param {string} value 
 * @param {string} format
 * @param {string} key
 */
const getValidDate = (isUTC, value, format, key) => {
    let momentDate = undefined;
    let now = undefined;
    if (isUTC) {
        if (format === 'x' || format === 'X') {
            momentDate = new Date(moment.utc(value).format("MM-DD-YYYY HH:mm:ss")).getTime();
        } else {
            momentDate = moment.utc(value).format(format);
        }
        now = moment().format(format);
    } else {
        if (format === 'x' || format === 'X') {
            momentDate = new Date(moment(value).format("MM-DD-YYYY HH:mm:ss")).getTime();
        } else {
            momentDate = moment(value).format(format);
        }
        now = moment().format(format);
    }
    if (typeof momentDate !== "number" && momentDate.includes("Invalid date")) {
        log.info('Setting default value for key: ' + key + ", value:  " + now);
        return now;
    }
    return momentDate;
}
module.exports = {
    HTTP_STATUS_CODE,
    requestTimeout,
    validateConfigfileParameters,
    concat,
    throwError,
    assignDataToSchema,
    checkSessionExpired,
    emitter,
    arrayUniqueByKey,
    cloneDeep,
    setTimer,
    validateSqlPushConfigParameters,
    validateSqlPullConfigParameters,
    drawLine,
    getValidDate,
};
