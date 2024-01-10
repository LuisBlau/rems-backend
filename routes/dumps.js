const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes
const btoa = require("btoa")
var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {
    app.get('/dumps/getDumps', async (req, res) => {
        console.log('/dumps/getDumps called with: ', req.query)
        var query = { "Retailer": req.query["retailerId"] };

        if (req.query["Store"]) {
            query.Store = { $regex: req.query.Store }
        }

        var snapshots = azureClient.db("pas_reloads").collection("dumps");
        const page = req.query.page ? Number(req.query.page) : 1;
        const limit = req.query.limit ? Number(req.query.limit) : 10;
        const skipValue = (page) * limit;

        snapshots.count(query).then((totalItem) => {
            if (req.query["tenantId"] === null) {
                var results = []

                snapshots.find(query).sort({ Timestamp: -1 }).skip(skipValue).limit(limit).toArray(function (err, result) {
                    results = result;
                    let modifiedResults = []
                    for (var x of results) {
                        var y = x

                        y["Download"] = x["location"]["URL"]
                        y["Version"] = x["values"]["Version"]
                        y["Reason"] = x["values"]["Reason"]
                        if (x["RegNum"]) {
                            y["System"] = "Register " + x["RegNum"]
                        } else {
                            y["System"] = x["values"]["Controller ID"]
                        }
                        y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
                        y["ExtractType"] = x["values"]["ExtractType"]
                        y["State"] = x["values"]["State"]
                        y["Rids"] = x["values"]["rids"]

                        modifiedResults.push(y)
                    }
                    res.send({
                        items: modifiedResults,
                        pagination: {
                            limit,
                            page,
                            totalItem,
                            totalPage: Math.ceil(totalItem / limit)
                        }
                    })
                });
            } else {
                var results = []
                if (req.query["retailerId"] !== 'null') {
                    snapshots.find(query).sort({ Timestamp: -1 }).skip(skipValue).limit(limit).toArray(function (err, result) {
                        results = result;
                        let modifiedResults = []
                        for (var x of results) {
                            var y = x

                            y["Download"] = x["location"]["URL"]
                            y["Version"] = x["values"]["Version"]
                            y["Reason"] = x["values"]["Reason"]
                            if (x["RegNum"]) {
                                y["System"] = "Register " + x["RegNum"]
                            } else {
                                y["System"] = x["values"]["Controller ID"]
                            }
                            y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
                            y["ExtractType"] = x["values"]["ExtractType"]
                            y["State"] = x["values"]["State"]
                            y["Rids"] = x["values"]["rids"]

                            modifiedResults.push(y)
                        }
                        res.send({
                            items: modifiedResults,
                            pagination: {
                                limit,
                                page,
                                totalItem,
                                totalPage: Math.ceil(totalItem / limit)
                            }
                        })
                    });
                }
            }
        })
    });

    app.get('/dumps/getDumpsForStore', async (req, res) => {
        console.log('/dumps/getDumpsForStore with: ', req.query)
        var snapshots = azureClient.db("pas_reloads").collection("dumps");
        let query = {}
        if (req.query["tenantId"] === undefined) {
            query = { Retailer: req.query.retailerId, Store: req.query.storeName }
        } else {
            query = { Retailer: req.query.retailerId, Store: req.query.storeName, tenant_id: req.query.tenantId }
        }

        const page = req.query.page ? Number(req.query.page) : 1;
        const limit = req.query.limit ? Number(req.query.limit) : 10;
        const skipValue = (page) * limit;

        snapshots.count(query).then((totalItem) => {
            snapshots.find(query).sort({ Timestamp: -1 }).skip(skipValue).limit(limit).toArray(function (err, results) {
                if (err) {
                    const msg = { "error": err }
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err
                } else if (!results) {
                    const msg = { "message": "No dumps found for store" }
                    res.status(statusCode.NO_CONTENT).json(msg);
                } else {
                    let modifiedResults = []
                    for (var x of results) {
                        var y = x

                        y["Download"] = x["location"]["URL"]
                        y["Version"] = x["values"]["Version"]
                        y["Reason"] = x["values"]["Reason"]
                        if (x["RegNum"]) {
                            y["System"] = "Register " + x["RegNum"]
                        } else {
                            y["System"] = x["values"]["Controller ID"]
                        }
                        y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
                        y["ExtractType"] = x["values"]["ExtractType"]
                        y["State"] = x["values"]["State"]
                        y["Rids"] = x["values"]["rids"]

                        modifiedResults.push(y)
                    }
                    res.send({
                        items: modifiedResults,
                        pagination: {
                            limit,
                            page,
                            totalItem,
                            totalPage: Math.ceil(totalItem / limit)
                        }
                    })
                }
            })
        })
    });
}