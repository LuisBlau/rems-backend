docker build -t dashboard-express-server:latest .
docker tag dashboard-express-server:latest remscontainer.azurecr.io/dashboard-express-server:latest
docker push remscontainer.azurecr.io/dashboard-express-server:latest