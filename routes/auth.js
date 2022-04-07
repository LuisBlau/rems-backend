
const jwt = require('jsonwebtoken');
module.exports = function (app, connection, log) {
	app.get("/auth/login",(req,res) => {
		console.log("test2")
		if(req.query["username"] != "invalid") {
			res.send(403)
			return
		}
		var c = jwt.sign({
			exp: Math.floor(Date.now() / 1000) + (60 * 60), //expires in 1 hour
			data: {"username":"invalid"}
		}, secret)
		console.log(c)
		res.cookie("auth",c);
		res.send(200)
	})
	app.get("/auth/checkauth",(req,res) => {
		console.log("Test")
		try {
			var decoded = jwt.verify(req.cookies["auth"], secret);
		} catch(err) {
			console.log(err)
			// the cookie is invalid
			res.send(403)
			return
		}
		console.log("Decoded:"+decoded)
		if(decoded.data.username == undefined) {
			console.log("invalid username")
			res.send(403)
			console.log("invalid username")
			console.log("invalid username")
			return
		}
		res.send(200)
	})
}