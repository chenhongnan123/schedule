'use strict';
module.exports.maintenanceplan = maintenanceplan;
const nodePackage = require('../service/nodepackage.service');
const { startOfToday, endOfToday, format } = require('date-fns');

const NodePackage = nodePackage.NodePackage;
const elementService = require('../service/element.service.js').ElementService;
const bunyan = NodePackage.bunyan;
const Bree = NodePackage.bree;
const path = NodePackage.path;
const MaintenancePlanStatusValue = require('../utils/constant.json').maintenanceplanstatus;
const MaintenancePlanTypeValue = require('../utils/constant.json').maintenanceplantype;
function maintenanceplan(config, utility, tags, emitter) {
  const log = bunyan.createLogger({ name: 'Maintenance_plan', level: config.logger.loglevel })
  const elements = config.elements;
  const defaults = config.defaults;
  const maintenanceplanTags = tags.maintenanceplantags;
  const maintenancetaskTags = tags.maintenancetasktags;
  const sparepartsinplanningTags = tags.sparepartsinplanningtags;
  const replacementTags = tags.replacementtags;

  const taskoperatorTags = tags.taskoperatortags;
  const operatorbindmachineTags = tags.operatorbindmachinetags;
  const taskdetailTags = tags.taskdetailtags;
  const solutiondetailTags = tags.solutiondetailtags;
  const machinetags = tags.machinetags;
  let retryServerTimer = defaults.retryServerTimer || 10;   // in seconds

  return {
    maintenanceplanList: {},
    TBMList: {},
    CBMList: {},
    initEmitter() {
      emitter.on('maintenanceplan', (data) => {
        if (data[maintenanceplanTags.STATUS_TAG] == MaintenancePlanStatusValue.ENABLE) {
          log.error(`Get New MaintenancePlan: ${JSON.stringify(data)}`);
          this.maintenanceplanList[data[maintenanceplanTags.PLANID_TAG]] = data;
          // add new schedule
          if (data[maintenanceplanTags.TYPE_TAG] == MaintenancePlanTypeValue.TBM) {
            if (this.TBMList[data[maintenanceplanTags.PLANID_TAG]]) {
              this.TBMList[data[maintenanceplanTags.PLANID_TAG]].stop();
              delete this.TBMList[data[maintenanceplanTags.PLANID_TAG]];
            }
            this.ValidateTBMSchedule(data);
          } else if (data[maintenanceplanTags.TYPE_TAG] == MaintenancePlanTypeValue.CBM) {
            delete this.CBMList[data[maintenanceplanTags.PLANID_TAG]]
            this.ValidateCBMSchedule(data);
          }
          log.error(`All maintenanceplan till now  ${JSON.stringify(this.maintenanceplanList)}`);
        } else {
          // remove  schedule
          if (this.maintenanceplanList[data[maintenanceplanTags.PLANID_TAG]]) {
            delete this.maintenanceplanList[data[maintenanceplanTags.PLANID_TAG]];
            if (data[maintenanceplanTags.TYPE_TAG] == MaintenancePlanTypeValue.TBM) {
              this.TBMList[data[maintenanceplanTags.PLANID_TAG]].stop();
              delete this.TBMList[data[maintenanceplanTags.PLANID_TAG]];
            } else if (data[maintenanceplanTags.TYPE_TAG] == MaintenancePlanTypeValue.CBM) {
              delete this.CBMList[data[maintenanceplanTags.PLANID_TAG]]
            }
            log.error(`All maintenanceplan till now  ${JSON.stringify(this.maintenanceplanList)}`);
          }
        }

      })
      emitter.on('machine', (data) => {
        log.error(`MACHINE Trigger: ${JSON.stringify(data)}`);
        const machinename = data[machinetags.MACHINENAME_TAG];
        const initcount = Number(data[machinetags.INITCOUNT]);
        const count = Number(data[machinetags.COUNT_TAG]);
        for (const key in this.CBMList) {
          if (Object.hasOwnProperty.call(this.CBMList, key)) {
            debugger;
            const item = this.CBMList[key];
            const $machinename = item[maintenanceplanTags.MACHINENAME_TAG];
            if ($machinename == machinename) {
              const lasttrigger = Number(item[maintenanceplanTags.LASTTRIGGER_TAG] ? item[maintenanceplanTags.LASTTRIGGER_TAG] : 0);
              const duration = Number(item[maintenanceplanTags.DURATION_TAG]);
              let countdiff = 0;
              if (lasttrigger == 0) {
                countdiff = count - initcount;
              } else {
                countdiff = count - lasttrigger;
              }
              if (countdiff >= duration) {
                log.error(`New CBM Job Trigger: ${JSON.stringify(data)}`);
                this.maintenanceTaskJob(item, count);
              }
            }
          }
        }
      })
    },
    async initMaintenancePlan() {
      const elementName = elements.maintenanceplan || 'maintenanceplan';
      try {
        log.error(`Get MaintenancePlan`);
        let query = `query=${maintenanceplanTags.STATUS_TAG}=="${MaintenancePlanStatusValue.ENABLE}"`;
        const response = await elementService.getElementRecords(elementName, query);
        if (response.data && response.data.results) {
          const planList = response.data.results;
          planList.forEach(data => {
            this.maintenanceplanList[data[maintenanceplanTags.PLANID_TAG]] = data;
            if (data[maintenanceplanTags.TYPE_TAG] == MaintenancePlanTypeValue.TBM) {
              this.ValidateTBMSchedule(data);
            } else if (data[maintenanceplanTags.TYPE_TAG] == MaintenancePlanTypeValue.CBM) {
              this.ValidateCBMSchedule(data);
            }
          });
          log.error(`All maintenanceplan till now  ${JSON.stringify(this.maintenanceplanList)}`);
        } else {
          log.error(`maintenanceplan not found for elementName : ${elementName} ${JSON.stringify(response.data)}`);
          utility.checkSessionExpired(response.data);
          await utility.setTimer(retryServerTimer);
          await this.initMaintenancePlan();
        }
      } catch (ex) {
        log.error(`Exception to fetch maintenanceplan for element : ${elementName}`);
        const messageObject = ex.response ? ex.response.data : ex
        log.error(messageObject);
        await utility.setTimer(retryServerTimer);
        await this.initMaintenancePlan();
      }
    },
    ValidateCBMSchedule(data) {
      this.CBMList[data[maintenanceplanTags.PLANID_TAG]] = data;
    },
    ValidateTBMSchedule(data) {
      const job = new Bree({
        root: path.resolve('/home/emgda/shopworx/schedule/jobs'),
        // root: path.resolve('./jobs'),
        jobs: [{
          name: 'maintenance_task',
          worker: {
            workerData: {
              planData: data,
              config: config,
              tags: tags,
            }
          },
          cron: data[maintenanceplanTags.CRON_TAG],
        }],
        cronValidate: {
          override: { useAliases: true }
        }
      });
      job.start();
      this.TBMList[data[maintenanceplanTags.PLANID_TAG]] = job;
    },
    // Create Maintenance Task
    async maintenanceTaskJob(plan, count) {
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
          [maintenancetaskTags.TASKTRIGGER_TAG]: count,
          [maintenancetaskTags.STATUS_TAG]: 'new',
          [maintenancetaskTags.PLANSTARTTIME_TAG]: startOfToday().getTime(),
          [maintenancetaskTags.PLANENDTIME_TAG]: endOfToday().getTime(),
          [maintenancetaskTags.PLANDATE_TAG]: Number(format(new Date(), "yyyyMMdd")),
          assetid: plan.assetid,
          [maintenancetaskTags.TYPE_TAG]: 'CBM',
        };
        const response = await elementService.createElementRecord(
          elements.maintenancetask,
          payload
        );

        if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
          log.error(
            `Maintenance_Task Record saved successfully in ShopWorx`
          );
          let query = `query=planid=="${plan[maintenanceplanTags.PLANID_TAG]}"`;
          query += `&sortquery=createdTimestamp==-1&pagenumber=1&pagesize=1`;
          const response = await elementService.getElementRecords(
            elements.maintenancetask,
            query
          );
          if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
            if (response.data.results.length > 0) {
              const task = response.data.results[0];
              // Create Task Details
              this.createTaskDetails(plan[maintenanceplanTags.SOLUTION_TAG], plan, task);
              // Create Task Operator
              this.createTaskOperator(plan, task);
              // Create Replacement
              this.createReplacement(plan, task);
              // Update Maintenace Plan
              this.updateMaintenancePlan(plan);
            } else {
              utility.checkSessionExpired(response.data);
              log.error(
                `Error in writing Maintenance_Task in ShopWorx ${JSON.stringify(
                  response.data
                )}`
              );
              await utility.setTimer(retryServerTimer);
              await this.maintenanceTaskJob(plan);
            }
          } else {
            utility.checkSessionExpired(response.data);
            log.error(
              `Error in writing Maintenance_Task in ShopWorx ${JSON.stringify(
                response.data
              )}`
            );
            await utility.setTimer(retryServerTimer);
            await this.maintenanceTaskJob(plan);
          }
        } else {
          utility.checkSessionExpired(response.data);
          log.error(
            `Error in writing Maintenance_Task in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await utility.setTimer(retryServerTimer);
          await this.maintenanceTaskJob(plan, count);
        }
      } catch (ex) {
        log.error(`Exception to Create Maintenance Task: ${JSON.stringify(plan)}`);
        const messageObject = ex.response ? ex.response.data : ex;
        log.error(messageObject);
        await utility.setTimer(retryServerTimer);
        await this.maintenanceTaskJob(plan, count);
      }
    },

    async updateMaintenancePlan(plan, count) {
      try {
        let payload = {
          [maintenanceplanTags.ALLTASK_TAG]: (plan[maintenanceplanTags.ALLTASK_TAG] ? plan[maintenanceplanTags.ALLTASK_TAG] : 0) + 1,
          [maintenanceplanTags.LASTTRIGGER_TAG]: count,
          assetid: plan.assetid,
        };
        const query = `?query=planid=="${plan.planid}"`;
        const response = await elementService.updateElementRecordsByQuery(
          elements.maintenanceplan,
          payload,
          query
        );

        if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
          log.error(
            `Maintenance_Plan Record saved successfully in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
        } else {
          utility.checkSessionExpired(response.data);
          log.error(
            `Error in writing Maintenance_Plan in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await utility.setTimer(retryServerTimer);
          await this.updateMaintenancePlan(plan, count);
        }
      } catch (ex) {
        log.error(`Exception to Update Maintenance Plan: ${JSON.stringify(plan)}`);
        const messageObject = ex.response ? ex.response.data : ex;
        log.error(messageObject);
        await utility.setTimer(retryServerTimer);
        await this.updateMaintenancePlan(plan, count);
      }
    },

    async createTaskDetails(solutionid, plan, task) {
      try {
        const query = `query=solutionid=="${solutionid}"`;
        const response = await elementService.getElementRecords(
          elements.solutiondetail,
          query
        );

        if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
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
                assetid: plan.assetid,
              }
            })
            const response = await elementService.createElementMultipleRecords(
              elements.taskdetail,
              bulkpayload
            );
            if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
              log.error(
                `Maintenance_Task_Detail Record saved successfully in ShopWorx ${JSON.stringify(
                  response.data
                )}`
              );
            } else {
              utility.checkSessionExpired(response.data);
              log.error(
                `Error in writing Maintenance_Task_Detail in ShopWorx ${JSON.stringify(
                  response.data
                )}`
              );
              await utility.setTimer(retryServerTimer);
              await this.createTaskDetails(solutionid, plan, task);
            }
          }
        } else {
          utility.checkSessionExpired(response.data);
          log.error(
            `Error in Fetch Solution_Detail in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await utility.setTimer(retryServerTimer);
          await this.createTaskDetails(solutionid, plan, task);
        }
      } catch (ex) {
        log.error(`Exception to Create Task Details: ${JSON.stringify(solutionid)}`);
        const messageObject = ex.response ? ex.response.data : ex;
        log.error(messageObject);
        await utility.setTimer(retryServerTimer);
        await this.createTaskDetails(solutionid, plan, task);
      }
    },
    async createTaskOperator(plan, task) {
      try {
        const query = `query=machineid=="${plan[maintenanceplanTags.MACHINEID_TAG]}"`;
        const response = await elementService.getElementRecords(
          elements.operatorbindmachine || 'operatorbindmachine',
          query
        );

        if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
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
            const response = await elementService.createElementMultipleRecords(
              elements.taskoperator || 'taskoperator',
              bulkpayload
            );
            if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
              log.error(
                `Maintenance_Task_Operator Record saved successfully in ShopWorx ${JSON.stringify(
                  response.data
                )}`
              );
            } else {
              utility.checkSessionExpired(response.data);
              log.error(
                `Error in writing Maintenance_Task_Detail in ShopWorx ${JSON.stringify(
                  response.data
                )}`
              );
              await utility.setTimer(retryServerTimer);
              await this.createTaskOperator(plan, task);
            }
          }
        } else {
          utility.checkSessionExpired(response.data);
          log.error(
            `Error in Fetch Solution_Detail in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await utility.setTimer(retryServerTimer);
          await this.createTaskOperator(plan, task);
        }
      } catch (ex) {
        log.error(`Exception to Create Task Operators`);
        const messageObject = ex.response ? ex.response.data : ex;
        log.error(messageObject);
        await utility.setTimer(retryServerTimer);
        await this.createTaskOperator(plan, task);
      }
    },
    async createReplacement(plan, task) {
      try {
        const query = `query=planid=="${plan[maintenanceplanTags.PLANID_TAG]}"`;
        const response = await elementService.getElementRecords(
          elements.sparepartsinplanning || 'sparepartsinplanning',
          query
        );

        if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
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
            const response = await elementService.createElementMultipleRecords(
              elements.replacement || 'replacement',
              bulkpayload
            );
            if (response.status === utility.HTTP_STATUS_CODE.SUCCESS) {
              log.error(
                `Maintenance_Task_Replacement Record saved successfully in ShopWorx ${JSON.stringify(
                  response.data
                )}`
              );
            } else {
              utility.checkSessionExpired(response.data);
              log.error(
                `Error in writing Maintenance_Task_Replacement in ShopWorx ${JSON.stringify(
                  response.data
                )}`
              );
              await utility.setTimer(retryServerTimer);
              await this.createReplacement(plan, task);
            }
          }
        } else {
          utility.checkSessionExpired(response.data);
          log.error(
            `Error in Fetch Sparepartsinplanning in ShopWorx ${JSON.stringify(
              response.data
            )}`
          );
          await utility.setTimer(retryServerTimer);
          await this.createReplacement(plan, task);
        }
      } catch (ex) {
        log.error(`Exception to Create Task Replacement`);
        const messageObject = ex.response ? ex.response.data : ex;
        log.error(messageObject);
        await utility.setTimer(retryServerTimer);
        await this.createReplacement(plan, task);
      }
    }
  }

}
