const Worker = require('bthreads');
const basic = require('./basic');
const nodePackage = require('../service/nodepackage.service');
const EventEmitter = require('events');
const { startOfToday, endOfToday, format } = require('date-fns');

let emitter = new EventEmitter.EventEmitter();
const { HTTP_STATUS_CODE, setTimer, ApiService } = basic;
const { workerData } = Worker;
const { planData, config, tags } = workerData;
const NodePackage = nodePackage.NodePackage;

const bunyan = NodePackage.bunyan;
const server = config.server;
const credential = config.credential;
const elements = config.elements;
const retryServer = config.defaults.retry || 10;
const requestTimeout = config.defaults.requesttimeout || 40;
let onStartup = false;
const maintenanceplanTags = tags.maintenanceplantags;
const maintenancetaskTags = tags.maintenancetasktags;
const taskdetailTags = tags.taskdetailtags;
const solutiondetailTags = tags.solutiondetailtags;
const taskoperatorTags = tags.taskoperatortags;
const operatorbindmachineTags = tags.operatorbindmachinetags;
const sparepartsinplanningTags = tags.sparepartsinplanningtags;
const replacementTags = tags.replacementtags;

const log = bunyan.createLogger({
  name: `Maintenance_Task for ${planData[maintenanceplanTags.PLANID_TAG]}`,
  level: config.logger.loglevel,
});

// Init Shopworx ApiService
const apiService = new ApiService(server);
apiService.setTimeout(requestTimeout);
// set loginType in axios header
apiService.setDefaultHeader(config.loginType);

// Auth Payload
const login_payload = {
  identifier: credential.identifier,
  password: credential.password,
};

// Element Api
const ElementService = {
  createElementRecord(elementName, data) {
    return apiService.post(`/server/elements/${elementName}/records`, data);
  },
  updateElementRecordsByQuery(elementName, data, query) {
    let url = `/server/elements/${elementName}/records`;
    if (query) {
      url += `?${query}`;
    }
    return apiService.put(url, data);
  },
  updateElementRecordById(elementName, data, id) {
    return apiService.put(
      `/server/elements/${elementName}/records/${id}`,
      data
    );
  },
  createElementMultipleRecords(elementName, data) {
    return apiService.post(`/server/elements/${elementName}/createbulkrecords`, data);
  },
  getElementRecords(elementName, query) {
    let url = `/server/elements/${elementName}/records`;
    if (query) {
      url += `?${query}`
    }
    return apiService.get(`${url}`);
  }
};

const checkSessionExpired = (data) => {
  if (data && data.errors && data.errors.errorCode === 'INVALID_SESSION') {
    log.error(`Session Id expired ${JSON.stringify(data.errors)}`);
    emitter.emit('sessionExpired');
  }
};

async function getAuthentication(login_payload) {
  const response = await apiService.post('/server/authenticate', login_payload);
  const { status, data } = response;
  if (status === HTTP_STATUS_CODE.SUCCESS && data) {
    apiService.setHeader(data.sessionId);
    if (!onStartup) {
      onStartup = true;
      emitter.emit('init');
    }
  } else {
    // retry for authentication
    log.error(
      `Error in authentication to server ${JSON.stringify(response.data)}`
    );
    await setTimer(retryServer);
    await this.getAuthentication();
  }
}
// Create Maintenance Task
async function maintenanceTaskJob(plan) {
  try {
    let payload = {
      [maintenancetaskTags.PLANID_TAG]: plan[maintenanceplanTags.PLANID_TAG],
      [maintenancetaskTags.PLANNAME_TAG]:
        plan[maintenanceplanTags.PLANNAME_TAG],
      [maintenancetaskTags.MACHINEID_TAG]:
        plan[maintenanceplanTags.MACHINEID_TAG],
      [maintenancetaskTags.MACHINENAME_TAG]:
        plan[maintenanceplanTags.MACHINENAME_TAG],
      [maintenancetaskTags.MACHINECODE_TAG]:
        plan[maintenanceplanTags.MACHINECODE_TAG],
      [maintenancetaskTags.SOLUTION_TAG]:
        plan[maintenanceplanTags.SOLUTION_TAG],
      [maintenancetaskTags.SOLUTIONNAME_TAG]:
        plan[maintenanceplanTags.SOLUTIONNAME_TAG],
      [maintenancetaskTags.SOLUTIONTYPE_TAG]:
        plan[maintenanceplanTags.SOLUTIONTYPE_TAG],
      [maintenancetaskTags.CREATEDTIME]: new Date().getTime(),
      [maintenancetaskTags.STATUS_TAG]: 'new',
      [maintenancetaskTags.TASKTRIGGER_TAG]: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"),
      [maintenancetaskTags.PLANSTARTTIME_TAG]: startOfToday().getTime(),
      [maintenancetaskTags.PLANENDTIME_TAG]: endOfToday().getTime(),
      [maintenancetaskTags.PLANDATE_TAG]: Number(format(new Date(), "yyyyMMdd")),
      [maintenancetaskTags.TYPE_TAG]: 'TBM',
      assetid: plan.assetid,
    };
    const response = await ElementService.createElementRecord(
      elements.maintenancetask,
      payload
    );

    if (response.status === HTTP_STATUS_CODE.SUCCESS) {
      let query = `query=planid=="${plan[maintenanceplanTags.PLANID_TAG]}"`;
      query += `&sortquery=createdTimestamp==-1&pagenumber=1&pagesize=1`;
      const response = await ElementService.getElementRecords(
        elements.maintenancetask,
        query
      );
      if (response.status === HTTP_STATUS_CODE.SUCCESS) {
        if (response.data.results.length > 0) {
          const task = response.data.results[0];
          // Create Task Details
          createTaskDetails(plan[maintenanceplanTags.SOLUTION_TAG], plan, task);
          // Create Task Operator
          createTaskOperator(plan, task);
          // Create Replacement
          createReplacement(plan, task);
          // Update Maintenace Plan
          updateMaintenancePlan(plan);
        } else {
          checkSessionExpired(response.data);
          log.error(
            `Error in writing Maintenance_Task in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await setTimer(retryServer);
          await maintenanceTaskJob(plan);
        }
      } else {
        checkSessionExpired(response.data);
        log.error(
          `Error in writing Maintenance_Task in ShopWorx ${JSON.stringify(
            response.data
          )}`
        );
        await setTimer(retryServer);
        await maintenanceTaskJob(plan);
      }
    } else {
      checkSessionExpired(response.data);
      log.error(
        `Error in writing Maintenance_Task in ShopWorx ${JSON.stringify(
          response.data
        )}`
      );
      await setTimer(retryServer);
      await maintenanceTaskJob(plan);
    }
  } catch (ex) {
    log.error(`Exception to Create Maintenance Task: ${JSON.stringify(plan)}`);
    const messageObject = ex.response ? ex.response.data : ex;
    log.error(messageObject);
    await setTimer(retryServer);
    await maintenanceTaskJob(plan);
  }
}

async function updateMaintenancePlan(plan) {
  try {
    let payload = {
      [maintenanceplanTags.ALLTASK_TAG]: (plan[maintenanceplanTags.ALLTASK_TAG] ? plan[maintenanceplanTags.ALLTASK_TAG] : 0) + 1,
      [maintenanceplanTags.LASTTRIGGER_TAG]: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"),
      assetid: plan.assetid,
    };
    const query = `query=planid=="${plan.planid}"`;
    const response = await ElementService.updateElementRecordsByQuery(
      elements.maintenanceplan,
      payload,
      query
    );

    if (response.status === HTTP_STATUS_CODE.SUCCESS) {
      log.error(
        `Maintenance_Plan Record saved successfully in ShopWorx ${JSON.stringify(
          response.data
        )}`
      );
    } else {
      checkSessionExpired(response.data);
      log.error(
        `Error in writing Maintenance_Plan in ShopWorx ${JSON.stringify(
          response.data
        )}`
      );
      await setTimer(retryServer);
      await updateMaintenancePlan(plan);
    }
  } catch (ex) {
    log.error(`Exception to Update Maintenance Plan: ${JSON.stringify(plan)}`);
    const messageObject = ex.response ? ex.response.data : ex;
    log.error(messageObject);
    await setTimer(retryServer);
    await updateMaintenancePlan(plan);
  }
}

async function createTaskDetails(solutionid, plan, task) {
  try {
    const query = `query=solutionid=="${solutionid}"`;
    const response = await ElementService.getElementRecords(
      elements.solutiondetail,
      query
    );

    if (response.status === HTTP_STATUS_CODE.SUCCESS) {
      log.error(
        `Solution_Detail Record Fetched successfully in ShopWorx`
      );
      const details = response.data.results;
      if (details.length > 0) {

        const bulkpayload = details.map(detail => {
          return {
            [taskdetailTags.TASKID_TAG]: task[maintenancetaskTags.TASKID_TAG],
            [taskdetailTags.SOLUTION_TAG]: detail[solutiondetailTags.SOLUTION_TAG],
            [taskdetailTags.SOLUTIONNAME_TAG]: detail[solutiondetailTags.SOLUTIONNAME_TAG],
            [taskdetailTags.SOLUTIONDETAILNAME_TAG]: detail[solutiondetailTags.NAME_TAG],
            [taskdetailTags.DESCRIPTION_TAG]: detail[solutiondetailTags.DESCRIPTION_TAG],
            [taskdetailTags.GROUP_TAG]: detail[solutiondetailTags.GROUP_TAG],
            [taskdetailTags.ISLIMITED_TAG]: detail[solutiondetailTags.ISLIMITED_TAG],
            [taskdetailTags.LOWER_TAG]: detail[solutiondetailTags.LOWER_TAG],
            [taskdetailTags.RESULT_TAG]: "",
            [taskdetailTags.TYPE_TAG]: detail[solutiondetailTags.TYPE_TAG],
            [taskdetailTags.UPPER_TAG]: detail[solutiondetailTags.UPPER_TAG],
            [taskdetailTags.VALUE_TAG]: "",
            [taskdetailTags.IMAGE_TAG]: detail[solutiondetailTags.IMAGE_TAG],
            assetid: plan.assetid,
          }
        })
        const response = await ElementService.createElementMultipleRecords(
          elements.taskdetail,
          bulkpayload
        );
        if (response.status === HTTP_STATUS_CODE.SUCCESS) {
          log.error(
            `Maintenance_Task_Detail Record saved successfully in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
        } else {
          checkSessionExpired(response.data);
          log.error(
            `Error in writing Maintenance_Task_Detail in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await setTimer(retryServer);
          await createTaskDetails(solutionid, plan, task);
        }
      }
    } else {
      checkSessionExpired(response.data);
      log.error(
        `Error in Fetch Solution_Detail in ShopWorx ${JSON.stringify(
          response.data
        )}`
      );
      await setTimer(retryServer);
      await createTaskDetails(solutionid, plan, task);
    }
  } catch (ex) {
    log.error(`Exception to Create Task Details: ${JSON.stringify(solutionid)}`);
    const messageObject = ex.response ? ex.response.data : ex;
    log.error(messageObject);
    await setTimer(retryServer);
    await createTaskDetails(solutionid, plan, task);
  }
}

async function createTaskOperator(plan, task) {
  try {
    const query = `query=machineid=="${plan[maintenanceplanTags.MACHINEID_TAG]}"`;
    const response = await ElementService.getElementRecords(
      elements.operatorbindmachine || 'operatorbindmachine',
      query
    );

    if (response.status === HTTP_STATUS_CODE.SUCCESS) {
      log.error(
        `Operator Record Fetched successfully in ShopWorx`
      );
      const details = response.data.results;
      if (details.length > 0) {

        const bulkpayload = details.map(detail => {
          return {
            [taskoperatorTags.TASKID_TAG]: task[maintenancetaskTags.TASKID_TAG],
            [taskoperatorTags.PLANID_TAG]: plan[maintenanceplanTags.PLANID_TAG],
            [taskoperatorTags.PLANNAME_TAG]: plan[maintenanceplanTags.PLANNAME_TAG],
            [taskoperatorTags.OPERATORID_TAG]: detail[operatorbindmachineTags.OPERATORID_TAG],
            [taskoperatorTags.OPERATORNAME_TAG]: detail[operatorbindmachineTags.OPERATORNAME_TAG],
            assetid: plan.assetid,
          }
        })
        const response = await ElementService.createElementMultipleRecords(
          elements.taskoperator || 'taskoperator',
          bulkpayload
        );
        if (response.status === HTTP_STATUS_CODE.SUCCESS) {
          log.error(
            `Maintenance_Task_Operator Record saved successfully in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
        } else {
          checkSessionExpired(response.data);
          log.error(
            `Error in writing Maintenance_Task_Detail in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await setTimer(retryServer);
          await createTaskOperator(plan, task);
        }
      }
    } else {
      checkSessionExpired(response.data);
      log.error(
        `Error in Fetch Solution_Detail in ShopWorx ${JSON.stringify(
          response.data
        )}`
      );
      await setTimer(retryServer);
      await createTaskOperator(plan, task);
    }
  } catch (ex) {
    log.error(`Exception to Create Task Operators`);
    const messageObject = ex.response ? ex.response.data : ex;
    log.error(messageObject);
    await setTimer(retryServer);
    await createTaskOperator(plan, task);
  }
}

async function createReplacement(plan, task) {
  try {
    const query = `query=planid=="${plan[maintenanceplanTags.PLANID_TAG]}"`;
    const response = await ElementService.getElementRecords(
      elements.sparepartsinplanning || 'sparepartsinplanning',
      query
    );

    if (response.status === HTTP_STATUS_CODE.SUCCESS) {
      log.error(
        `Spareparts in Planning Record Fetched successfully in ShopWorx`
      );
      const details = response.data.results;
      if (details.length > 0) {

        const bulkpayload = details.map(detail => {
          return {
            [replacementTags.TASKID_TAG]: task[maintenancetaskTags.TASKID_TAG],
            [replacementTags.SPAREPARTID_TAG]: detail[sparepartsinplanningTags.SPAREPARTID_TAG],
            [replacementTags.SPAREPARTNAME_TAG]: detail[sparepartsinplanningTags.SPAREPARTNAME_TAG],
            [replacementTags.MACHINEPOSITIONID_TAG]: detail[sparepartsinplanningTags.MACHINEPOSITIONID_TAG],
            [replacementTags.MACHINEPOSITIONNAME_TAG]: detail[sparepartsinplanningTags.MACHINEPOSITIONNAME_TAG],
            [replacementTags.MACHINEID_TAG]: detail[sparepartsinplanningTags.MACHINEID_TAG],
            [replacementTags.MACHINENAME_TAG]: detail[sparepartsinplanningTags.MACHINENAME_TAG],
            [replacementTags.UPPER_TAG]: detail[sparepartsinplanningTags.UPPER_TAG],
            [replacementTags.LOWER_TAG]: detail[sparepartsinplanningTags.LOWER_TAG],
            assetid: plan.assetid,
          }
        })
        const response = await ElementService.createElementMultipleRecords(
          elements.replacement || 'replacement',
          bulkpayload
        );
        if (response.status === HTTP_STATUS_CODE.SUCCESS) {
          log.error(
            `Maintenance_Task_Replacement Record saved successfully in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
        } else {
          checkSessionExpired(response.data);
          log.error(
            `Error in writing Maintenance_Task_Replacement in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await setTimer(retryServer);
          await createReplacement(plan, task);
        }
      }
    } else {
      checkSessionExpired(response.data);
      log.error(
        `Error in Fetch Sparepartsinplanning in ShopWorx ${JSON.stringify(
          response.data
        )}`
      );
      await setTimer(retryServer);
      await createReplacement(plan, task);
    }
  } catch (ex) {
    log.error(`Exception to Create Task Replacement`);
    const messageObject = ex.response ? ex.response.data : ex;
    log.error(messageObject);
    await setTimer(retryServer);
    await createReplacement(plan, task);
  }
}

emitter.on('sessionExpired', () => {
  log.info(`Session Expired trying to reAuthenticate`);
  getAuthentication();
});
emitter.on('init', () => {
  log.error(`Authentication done successfully`);
  maintenanceTaskJob(planData);
});

getAuthentication(login_payload);
