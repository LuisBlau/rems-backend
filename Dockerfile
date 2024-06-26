# Install dependencies only when needed
FROM node:14.17.3

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
COPY *.cfg ./etc/

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production


# Bundle app source
COPY . .

EXPOSE 443 80
CMD [ "npm", "start" ]