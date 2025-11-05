ARG BUILD_FROM
FROM $BUILD_FROM

# Set the working directory
WORKDIR /usr/src/app

# Install dependencies
RUN apk add --update nodejs npm

# Install tzdata package
RUN apk add --no-cache tzdata

# Copy project files
COPY package*.json ./
COPY . .

# Install npm packages
RUN npm install

# Set the timezone to Bucharest
ENV TZ=Europe/Bucharest
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Expose port 8080
EXPOSE 8080

# Command to run the application
CMD [ "node", "app.js" ]

