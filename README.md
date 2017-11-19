# node_cbr

A web server for browsing and viewing .cbr and .cbz files.  Tested on Windows and Raspbian.

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
## Reading order files
In addition to reading .cbr and .cbz files it's possible to setup "Reading Order" files that list all of the issues for a particular story line.
* Create a text file with the name of the story line or event and with an ".ro" extension
* This file should contain one line per issue with the path of that issue, relative to the root of your comic book collection, for example:
  * If your comic collection was in c:\comics
  * And one of the comics you wanted in the reading order was c:\comics\Lone Ranger\Lone Ranger 1.cbz
  * Then the reading order entry would be:
    * \Lone Ranger\Lone Ranger 1.cbz
* Inside the web viewer .ro files appear the same as directories
