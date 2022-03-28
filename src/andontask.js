'use strict';
module.exports.andontask = andontask;
const nodePackage = require('../service/nodepackage.service');

const NodePackage = nodePackage.NodePackage;
const elementService = require('../service/element.service.js').ElementService;
const bunyan = NodePackage.bunyan;
const Bree = NodePackage.bree;
const path = NodePackage.path;
function andontask(config, utility, tags, emitter) {
  const log = bunyan.createLogger({ name: 'Andon_Task', level: config.logger.loglevel })
  const elements = config.elements;
  const defaults = config.defaults;
  const andonTags = tags.andontasktags;

  let retryServerTimer = defaults.retryServerTimer || 10;   // in seconds

  return {
    tokenPayload: null,
    andontaskList: {},
    initEmitter() {
      emitter.on('andontask', (data) => {
        if (data[andonTags.STATUS_TAG] == 0) {
          log.info(`Get New AndonTask: ${JSON.stringify(data)}`);
          // add new schedule
          if (this.andontaskList[data[andonTags.ID_TAG]]) {
            this.andontaskList[data[andonTags.ID_TAG]].stop();
            delete this.andontaskList[data[andonTags.ID_TAG]];
          }
          this.ValidateTaskSchedule(data);
        } else {
          // remove  schedule
          if (this.andontaskList[data[andonTags.ID_TAG]]) {
            this.andontaskList[data[andonTags.ID_TAG]].stop();
            delete this.andontaskList[data[andonTags.ID_TAG]];
          }
        }
      })
    },
    async initAndonTask() {
      const elementName = elements.andontask || 'andontask';
      try {
        this.tokenPayload = {
          corpid: 'wwd48654815ead7494',
          corpsecret: '-s5aKbzTXFAt41Jcgw1RR0mNt6l9xwbuu7YM29pC6Iw',
          agentid: 1000002,
        };
        const wechatconnection = await elementService.getElementRecords(elements.wechatconnection || 'wechatconnection');
        if (wechatconnection.data && wechatconnection.data.results) {
          if (wechatconnection.data.results.length) {
            const data = wechatconnection.data.results[0];
            this.tokenPayload.agentid = data.agentid;
            this.tokenPayload.corpid = data.corpid;
            this.tokenPayload.corpsecret = data.corpsecret;
          }
        }
        log.error(`Get AndonTask`);
        let query = `query=${andonTags.STATUS_TAG}==0`;
        const response = await elementService.getElementRecords(elementName, query);
        if (response.data && response.data.results) {
          const taskList = response.data.results;
          taskList.forEach(data => {
            this.ValidateTaskSchedule(data);
          });
        } else {
          log.error(`AndonTask not found for elementName : ${elementName} ${JSON.stringify(response.data)}`);
          utility.checkSessionExpired(response.data);
          await utility.setTimer(retryServerTimer);
          await this.initMaintenancePlan();
        }
      } catch (ex) {
        log.error(`Exception to fetch AndonTask for element : ${elementName}`);
        const messageObject = ex.response ? ex.response.data : ex
        log.error(messageObject);
        await utility.setTimer(retryServerTimer);
        await this.initAndonTask();
      }
    },
    ValidateTaskSchedule(data) {
      const job = new Bree({
        root: path.resolve('/home/emgda/shopworx/schedule/jobs'),
        // root: path.resolve('./jobs'),
        jobs: [{
          name: 'andon_wechat',
          worker: {
            workerData: {
              tokenPayload: this.tokenPayload,
              taskData: data,
              config: config,
              tags: tags,
              
            }
          },
          date: new Date(data.clock)
        }]
      });
      job.start();
      this.andontaskList[data[andonTags.ID_TAG]] = job;
    },
  }

}
