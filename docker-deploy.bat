docker build -t dashboard-express-server .
docker tag dashboard-express-server remscontainer.azurecr.io/dashboard-express-server
docker push remscontainer.azurecr.io/dashboard-express-server