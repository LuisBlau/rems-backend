const axios = require('axios');
const bodyParser = require('body-parser');
const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes
var { ObjectId } = require('mongodb')
var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
const { InsertAuditEntry } = require('../middleware/auditLogger');
azureClient.connect();

module.exports = function (app) {
    async function fetchFromKibana(uri, method, token, data = null) {
        const config = {
            method: method,
            url: uri,
            headers: {
                'kbn-xsrf': 'true',
                'Content-Type': 'application/json;charset=UTF-8',
                'Authorization': `Basic ${token}`
            },
            data: data
        };

        try {
            const response = await axios(config);
            return response;
        } catch (error) {
            console.error(`Error making the request: ${error.message}`);
            throw error;
        }
    }

    // Route to get rules
    app.get('/esalert/rules', async (req, res) => {
        try {
            const baseURI = req.query.baseURI;
            const token = req.query.token;
            const uri = `${baseURI}/api/alerting/rules/_find`;

            const response = await fetchFromKibana(uri, 'GET', token);
            const o = response.data;

            const retVal = []; // Initialize an array to store the rules
            const pages = Math.ceil(o.total / o.per_page) + 1;

            for (let x = 1; x <= pages; x++) {
                const response = await fetchFromKibana(`${baseURI}/api/alerting/rules/_find?page=${x}`, 'GET', token);
                retVal.push(...response.data.data);
            }

            return res.json(Array.from(retVal));
        } catch (ex) {
            console.error(`Failed to retrieve Elastic Search rules with exception message ${ex.message}`);
            if (ex.response) {
                return res.status(ex.response.status).send(ex.response.data.message);
            } else {
                return res.status(500).send('Internal Server Error');
            }
        }

    });

    // Route to get connectors
    app.get('/actions/connectors', async (req, res) => {
        try {
            const baseURI = req.query.baseURI;
            const token = req.query.token;
            const uri = `${baseURI}/api/actions/connectors`;

            const response = await fetchFromKibana(uri, 'GET', token);
            const jo = response.data;

            const retVal = new Map();
            jo.forEach(x => retVal.set(x.id, x));

            return res.json(Array.from(retVal));
        } catch (ex) {
            console.error(`Failed to retrieve Elastic Search connectors with exception message ${ex.message}`);
            if (ex.response) {
                return res.status(ex.response.status).send(ex.response.data.message);
            } else {
                return res.status(500).send('Internal Server Error');
            }
        }

    });

    // Route to create or update a metric threshold rule
    app.post('/esalert/rules/upsert', bodyParser.json(), async (req, res) => {
        try {
            const { id = '', name, connectorName, interval, aggType, timeUnit, comparator, timeSize, threshold, tags, filterQueryBodyText, filterQueryBodyJson, groupByFields, esBaseURI, esToken, email = '', snow, retailerId } = req.body;
            const isNewRule = !id || id === '';

            // Create a new JSON object for the rule
            const ruleBody = {
                name,
                notify_when: 'onActiveAlert'
            };

            if (isNewRule) {
                ruleBody.rule_type_id = 'metrics.alert.threshold';
                ruleBody.consumer = 'alerts';
                ruleBody.enabled = true;
            }

            const schedule = {
                interval: interval
            };
            ruleBody.schedule = schedule;

            const params = {
                criteria: [
                    {
                        comparator,
                        timeSize,
                        aggType,
                        threshold: [threshold],
                        timeUnit
                    }
                ],
                sourceId: 'default',
                alertOnNoData: true,
                alertOnGroupDisappear: true,
                groupBy: groupByFields,
                filterQueryText: filterQueryBodyText,
                filterQuery: filterQueryBodyJson
            };
            ruleBody.params = params;

            const uri = `${esBaseURI}/api/actions/connectors`;
            const connRes = await fetchFromKibana(uri, 'GET', esToken);
            const connectors = connRes.data;

            var webHookConnId;
            var emailId;
            for (i = 0; i < connectors.length; i++) {
                if(email !== '' && connectors[i].name === 'Elastic-Cloud-SMTP'){
                    emailId = connectors[i].id;
                }

                if (connectors[i].name === connectorName) {
                    webHookConnId = connectors[i].id;
                }
            }

            const actions = [];
            if (webHookConnId && webHookConnId !== '') {

                actions.push( {
                    id: webHookConnId,
                    params: {
                        body: `{"alertName": "{{rule.name}}","reason":"{{context.reason}}","group":"{{context.group}}","automaticSnowEvent":"${snow}","owner":"${retailerId}"}`
                    },
                    group: 'metrics.threshold.fired'
                })
            }

            if(email !== '' && emailId){
                actions.push({
                    id: emailId,
                    params: {
                        subject: `${name} Alert Notification`,
                        message: `{{context.reason}}, Thrown by Alert: {{rule.name}}, Affected: {{context.group}}, [View alert details]({{context.alertDetailsUrl}})`,
                        to: [email]
                    },
                    group: 'metrics.threshold.fired'
                });
            }

            ruleBody.actions = actions;
            if (tags) {
                ruleBody.tags = tags;
            }

            // Determine the HTTP method (POST for new rule, PUT for existing rule)
            const httpMethod = isNewRule ? 'POST' : 'PUT';

            // Determine the URL (append ruleId for PUT, omit for POST)
            let apiUrl = `${esBaseURI}/api/alerting/rule`;
            if (!isNewRule) {
                apiUrl += `/${id}`;
            }

            // Perform the HTTP request
            const response = await fetchFromKibana(apiUrl, httpMethod, esToken, ruleBody);
            const responseRuleId = response.data.id;

            return res.json({ id: responseRuleId });
        } catch (ex) {
            console.error(`Failed to create or update new Elastic Search rule with message ${ex.message}`);
            if (ex.response) {
                return res.status(ex.response.status).send(ex.response.data.message);
            } else {
                return res.status(500).send('Internal Server Error');
            }
        }

    });

    app.post('/esalert/rules/toggle', bodyParser.json(), async (req, res) => {
        try {
            const baseURI = req.query.baseURI;
            const token = req.query.token;
            const ruleId = req.query.ruleId;
            const isEnabled = req.body.enabled;

            const action = isEnabled ? '_enable' : '_disable';

            // Determine the URL for the POST request to enable or disable the rule
            const apiUrl = `${baseURI}/api/alerting/rule/${ruleId}/${action}`;

            const response = await fetchFromKibana(apiUrl, 'POST', token);

            if (response.status === 204) {
                console.info(`Rule with ruleId ${ruleId} has been successfully ${isEnabled ? 'enabled' : 'disabled'}.`);
                return res.status(204).end();
            } else if (response.status === 404) {
                console.info(`Rule with ruleId ${ruleId} not found. No action taken.`);
                return res.status(404).end();
            } else if (response.status === 401) {
                console.info(`Failed to authenticate to Elastic Search. No action taken.`);
                return res.status(404).end();
            } else {
                console.error(`Failed to ${isEnabled ? 'enable' : 'disable'} Elastic Search rule: ${response.status}; ${response.statusText}`);
                return res.status(500).send(`Failed to ${isEnabled ? 'enable' : 'disable'} due to an unknown issue. ${response.statusText}`);
            }
        } catch (ex) {
            console.error(`Failed to ${isEnabled ? 'enable' : 'disable'} Elastic Search rule with message ${ex.message}`);
            if (ex.response) {
                return res.status(ex.response.status).send(ex.response.data.message);
            } else {
                return res.status(500).send('Internal Server Error');
            }
        }
    });

    // Route to delete a metric threshold rule
    app.delete('/esalert/rules', async (req, res) => {
        try {
            const baseURI = req.query.baseURI;
            const token = req.query.token;
            const ruleId = req.query.ruleId;

            // Determine the URL for the DELETE request
            const apiUrl = `${baseURI}/api/alerting/rule/${ruleId}`;

            const response = await fetchFromKibana(apiUrl, 'DELETE', token);

            if (response.status === 204) {
                console.info(`Rule with ruleId ${ruleId} has been successfully deleted.`);
                return res.status(204).end();
            } else if (response.status === 404) {
                console.info(`Rule with ruleId ${ruleId} not found. No action taken.`);
                return res.status(404).end();
            } else if (response.status === 401) {
                console.info(`Failed to authenticate to Elastic Search. No action taken.`);
                return res.status(404).end();
            } else {
                console.error(`Failed to delete Elastic Search rule: ${response.status}; ${response.statusText}`);
                return res.status(500).send(`Failed delete because of an unknown exception. ${response.statusText}`);
            }
        } catch (ex) {
            console.error(`Failed to delete Elastic Search rule with message ${ex.message}`);
            if (ex.response) {
                return res.status(ex.response.status).send(ex.response.data.message);
            } else {
                return res.status(500).send('Internal Server Error');
            }
        }
    });

    app.delete('/esalert/rules/rulesmetadata/:ruleId', async (req, res) => {
        const ruleId = req.params.ruleId;
        const alerts = azureClient.db("pas_availability").collection("alerts");
    
        try {
            // Check if the document with the specified ruleId exists
            const existingDocument = await alerts.findOne({ ruleId: ruleId });
    
            if (!existingDocument) {
                res.status(statusCode.NOT_FOUND).json({ message: 'No matching document found' });
                return;
            }
    
            // Document found, proceed with deletion
            const query = {
                _id: ObjectId(existingDocument._id),
            };
    
            const result = await alerts.deleteOne(query);
    
            if (result.deletedCount === 1) {
                res.status(statusCode.OK).json({ message: 'Document deleted successfully' });
            } else {
                // Something went wrong with deletion
                res.status(statusCode.INTERNAL_SERVER_ERROR).json({ error: 'Error deleting document' });
            }
        } catch (error) {
            console.error('MongoDB delete error:', error);
            res.status(statusCode.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
        }
    });

    app.post('/esalert/rules/rulesmetadata/batch', bodyParser.json(), async (req, res) => {
        const ruleIds = req.body.ruleObjects;
        if (!ruleIds || !Array.isArray(ruleIds) || ruleIds.length === 0) {
            return res.status(statusCode.OK).json([]);
        }
        
        const alerts = azureClient.db("pas_availability").collection("alerts");
        try {
            const query = {
                ruleId: { $in: ruleIds },
            };
        
            const results = await alerts.find(query).toArray();
        
            res.status(statusCode.OK).json(results);
        } catch (error) {
            console.error('MongoDB query error:', error);
            res.status(statusCode.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error', data: [] });
        }
    });
    
    app.put('/esalert/rules/rulesmetadata', bodyParser.json(), async (req, res) => {
        const ruleId = req.body.ruleId;
        const createSNOW = req.body.createSNOW;
        const type = 'Rule';
    
        const alerts = azureClient.db("pas_availability").collection("alerts");
    
        try {
            const existingDocument = await alerts.findOne({ ruleId: ruleId });
    
            const updateQuery = existingDocument ? { _id: existingDocument._id } : { _id: ObjectId() };
    
            const updateFields = {
                createSNOW: createSNOW,
                type: type,
                retailer_id: '',
                ruleId: ruleId,
            };
    
            const updateOperation = {
                $set: updateFields,
            };
    
            const options = {
                upsert: true,
            };
    
            const result = await alerts.updateOne(updateQuery, updateOperation, options);
    
            if (result.matchedCount === 1 || result.upsertedCount === 1) {
                const updatedDocument = result.upsertedCount === 1 ? { _id: result.upsertedId._id, ...updateFields } : result.value;
                InsertAuditEntry('update', updatedDocument, updateOperation, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_availability', collection: 'alerts' });
                res.status(statusCode.OK).json({ message: 'document updated successfully' });
            } else {
                res.status(statusCode.NO_CONTENT).json({ message: 'Failed to insert or update document' });
            }
        } catch (exception) {
            console.error('Exception:', exception);
            res.status(statusCode.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
        }
    });
        
}
