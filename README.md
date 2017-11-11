# node_cbr

A web server for browsing and viewing .cbr and .cbz files.  Tested on Windows and Raspian.

## Setup

* Install [Node.js](https://nodejs.org/en/), I've tested on 6.10.3 and 8.9.1
* Place the node_cbr files into a directory, preserving directories
* Use npm to install dependencies:
```
npm install
```
* Update config.json to reference the location of your comic collection:
```
{
   "root_dir": "/mnt/drobo/comics"
}
```
* Launch node:
```
node index.js
```