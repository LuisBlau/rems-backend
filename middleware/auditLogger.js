const mongodb = require("mongodb")

/* cSpell:disable */
//setup azure connections
var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();
/* cSpell:enable */

function InsertAuditEntry(action, oldObject, message, user, destination) {
    // console.log('logging an audit entry')
    entryToInsert = {
        destination: destination,
        action: action,
        message: message,
        user: user,
        timestamp: new Date()
    }

    if (action === 'update' || action === 'delete') {
        entryToInsert.oldData = oldObject
    }

    var auditEntries = azureClient.db("pas_config").collection("audit-logs");
    auditEntries.insertOne(entryToInsert)
}

module.exports = {
    InsertAuditEntry
}