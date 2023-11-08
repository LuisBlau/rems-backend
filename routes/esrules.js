const axios = require('axios');
var bodyParser = require('body-parser');

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
            const { id = '', name, connectorName, interval, aggType, timeUnit, comparator, timeSize, threshold, tags, filterQuery, groupByFields, esBaseURI, esToken } = req.body;
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
                filterQueryText: filterQuery
            };
            ruleBody.params = params;

            const uri = `${esBaseURI}/api/actions/connectors`;
            const connRes = await fetchFromKibana(uri, 'GET', esToken);
            const connectors = connRes.data;

            var connId;
            for (i = 0; i < connectors.length; i++) {
                if (connectors[i].name === connectorName) {
                    connId = connectors[i].id;
                    break;
                }
            }

            if (connId && connId !== '') {
                const actions = [
                    {
                        id: connId,
                        params: {
                            body: '{"alertName": "{{rule.name}}","reason":"{{context.reason}}","group":"{{context.group}}"}'
                        },
                        group: 'metrics.threshold.fired'
                    }
                ];
                ruleBody.actions = actions;
            }

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
}
