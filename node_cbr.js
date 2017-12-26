#!/bin/env node
var config = require('./config');
var express = require('express');
var app = express();
var path = require('path');
var router = express.Router();
var fs = require('fs')
var unrar = require("node-unrar-js");
var yauzl = require('yauzl');
var sharp = require("sharp");
var locks = require('locks');
var isImage = require('is-image');

var extExtract = /(?:\.([^.]+))?$/;

app.use('/js', express.static(__dirname + '/js'));
app.use('/img', express.static(__dirname + '/img'));
app.use(express.static(__dirname + '/public'));

if (!config.expiration)
    config.expiration=7;
if (!config.cacheDirectory)
    config.cacheDirectory="cache";
if (!fs.existsSync(config.cacheDirectory))
    fs.mkdirSync(config.cacheDirectory);

var port = 3000;
if (config.port && config.port > 0)
    port = config.port;
app.listen(port);

fileAccess = {};
folderBuilder = [];
foldersInProcess = [];

setInterval(function() {
    fs.readdir(config.cacheDirectory, function(err, files) {
        if (err)
            console.log("readdir error:",err);
        files.forEach(function(file) {
            fs.stat(joinPaths(config.cacheDirectory,file), function(err, stats) {
                let expiration = new Date();
                expiration.setDate(expiration.getDate() - config.expiration);
                let fileDate = new Date(stats.mtime);
                if (fileDate < expiration) {
                    console.log("Removing cached page " + joinPaths(config.cacheDirectory,file));
                    if (stats.isDirectory())
                        fs.rmdirSync(joinPaths(config.cacheDirectory,file));
                    else
                        fs.unlinkSync(joinPaths(config.cacheDirectory,file));
                }
            });
        });
    });
},60 * 10 * 1000); // Every 10 minutes

setInterval(function() {
    while (folderBuilder.length) {
        let work = folderBuilder.pop();
        let found = false;
        for (let i = 0;i < foldersInProcess.length && !found;i ++) {
            if (foldersInProcess[i].folderJPG == work.folderJPG || foldersInProcess[i].sourceJPG == work.sourceJPG) {
                console.log("Duplicate work found ",work,foldersInProcess[i]);
                foldersInProcess[i].response = foldersInProcess[i].response.concat(work.response);
                found = true;
            }
        }

        if (found) {
            continue;
        }

        foldersInProcess.push(work);
        console.log("Saving folder icon",work.folderJPG);
        sharp(work.sourceJPG).resize(200).toFile(work.folderJPG, function(err) {
            if (err) {
                console.log("sharp write error ",err," writing file ",work.sourceJPG,work.folderJPG);
                fs.unlinkSync(work.sourceJPG);
                fs.unlinkSync(work.folderJPG);

                // sab 2017/11/10- Let everyone waiting on this image it didn't resize properly
                let res = work.response.pop();
                while (res) {
                    res.status(404).send("Not found");
                    res = work.response.pop();
                }

                for (let i = 0;i < foldersInProcess.length;i ++) {
                    if (foldersInProcess[i].folderJPG == work.folderJPG) {
                        foldersInProcess.splice(i,1);
                        break;
                    }
                }
            }
            else {
                console.log("Done saving folder icon",work.folderJPG);
                let res = work.response.pop();
                while (res) {
                    returnFile(work.folderJPG, res);
                    res = work.response.pop();
                }

                for (let i = 0;i < foldersInProcess.length;i ++) {
                    if (foldersInProcess[i].folderJPG == work.folderJPG) {
                        foldersInProcess.splice(i,1);
                        break;
                    }
                }
            }
        });
    }
},3000);

String.prototype.hashCode = function() {
    var hash = 0;
    if (this.length == 0) return hash;
    for (i = 0; i < this.length; i++) {
        char = this.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }

    return hash;
}
    
/* Directory Listing 
   {"Type":"dir", "Name": "%s", "Archive": 0}
   {"Type":"file","Name": "%s", "Archive":%d}
*/
router.get('/directory', function(req, res) {
    var listing = [];
    var directory=joinPaths(config.root_dir, req.query.dir);

    if (directory.endsWith("\\") || directory.endsWith("/"))
        directory = directory.slice(0,-1);

    console.log("dir",directory);

    if (directory.toUpperCase().endsWith(".RO")) {
        fs.readFile(directory, function(err, roFile) {
            roFile = roFile.toString().replace(/\r/g,'').replace(/\n+$/, "");
            let roLines = roFile.split('\n');
            for (let i = 0;i < roLines.length;i ++) {
                listing.push({Type:"file",Name:roLines[i],Archive:1});
            }

            console.log("Returning ",listing.length," items from ", directory);
            res.json(listing);
            return;
        });
    } else {
        fs.readdir(directory, function(err, files) {
            if (err)
                console.log("readdir error:",err);

            files.forEach(function(file) {
                let stats = fs.statSync(joinPaths(directory, file), res);
                if (!stats)
                    console.log("fs.stat Didn't work:",joinPaths(directory,file),err);
                else if (stats.isDirectory() || file.toUpperCase().endsWith(".RO")) {
                    listing.push({Type:"dir",Name:file,Archive:1});
                }
                else if (file.toUpperCase().endsWith(".CBZ") || file.toUpperCase().endsWith(".CBR"))
                    listing.push({Type:"file",Name:file,Archive:1});
            });
            listing.sort(function (a,b) {
                if (a.Name < b.Name)
                    return -1;
                else if (a.Name > b.Name)
                    return 1;
                return 0;
            });
            console.log("Returning ",listing.length," items");
            res.json(listing);
        });
    }
});

router.get('/thumbnail', function(req, res) {
    var comic = joinPaths(config.root_dir,req.query.comic);
    if (comic.toUpperCase().endsWith(".CBZ") || comic.toUpperCase().endsWith(".CBR") || comic.toUpperCase().endsWith(".RO"))
        generateThumbnail(comic, res, null);
    else
        generateThumbnail(comic, res, comic);
    });

router.get('/comicpage', function(req, res) {
    var comic = joinPaths(config.root_dir,req.query.comic);
    generatePage(comic, req.query.page, res, false);
});

router.get('/pages', function(req, res) {
    var comic = joinPaths(config.root_dir,req.query.comic);
    countPages(comic, res);
});

function joinPaths(beg, end) {
    if (path.sep == '/') {
        beg = beg.replace(/\\/g, "/");
        end = end.replace(/\\/g, "/");
    } else {
        beg = beg.replace(/\//g, "\\");
        end = end.replace(/\//g, "\\");
    }

    var ret = beg;

    if (!ret.endsWith(path.sep) && !end.startsWith(path.sep))
        ret += path.sep;
    ret += end;

    return ret;
}

function generateThumbnail(comic, res, saveFolderIcon) {
    fs.stat(comic, function(err, stats) {
        if (err)
            console.log("fs.stat error: ",comic,err);
        else if (!stats)
            console.log("fs.stat Didn't work: ",comic,err);
        else if (stats.isDirectory()) {
            if (fs.existsSync(joinPaths(comic,"folder.jpg"))) {
                console.log("Returning folder icon found in directory", comic);
                returnFile(joinPaths(comic,"folder.jpg"), res);
                return;
            }

            fs.readdir(comic, function(err, files) {
                if (err)
                    console.log("readdir error:",err);
                for (let i = 0;i < files.length;i ++) {
                    file = files[i];
                    if (file.toUpperCase().endsWith(".CBZ") || file.toUpperCase().endsWith(".CBR")) {
                        generateThumbnail(joinPaths(comic, file), res, saveFolderIcon);
                        return;
                    }
                }
                for (let i = 0;i < files.length;i ++) {
                    file = files[i];
                    if (file.toUpperCase().endsWith(".RO")) {
                        generateThumbnail(joinPaths(comic, file), res, saveFolderIcon);
                        return;
                    }
                    let stat = fs.statSync(joinPaths(comic, file), res);

                    if (stat.isDirectory()) {
                        generateThumbnail(joinPaths(comic, file), res, saveFolderIcon);
                        return;
                    }
                }
            });
        }            
        else if (comic.toUpperCase().endsWith(".RO")) {
            console.log("Generating icon for reading order file ",comic);
            fs.readFile(comic, function(err, roFile) {
                roFile = roFile.toString().replace(/\r/g,'').replace(/\n+$/, "");
                roLines = roFile.split('\n');
                console.log("Read file containing ",roLines.length, "lines, first line is",roLines[0]);
                if (roLines.length > 0)
                    generatePage(joinPaths(config.root_dir,roLines[0]), 1, res, saveFolderIcon);
                return;
            });
        }
        else if (comic.toUpperCase().endsWith(".CBZ") || comic.toUpperCase().endsWith(".CBR")) {
            generatePage(comic, 1, res, saveFolderIcon);
        }
    });
}

function countPages(comic, res) {
    if (comic.toUpperCase().endsWith(".CBZ")) {
        countPagesCBZ(comic, res);
    }
    if (comic.toUpperCase().endsWith(".CBR")) {
        countPagesCBR(comic, res);
    }
}

function countPagesCBZ(comic, res) {
    yauzl.open(comic, {}, function(err, zipFile) {
        if (err) {
            console.log("Error opening cbz:",err);
            res.json({Pages:count});
        }
        else {
            let count = 0;
            zipFile.on("entry", function(entry) {
                if (isImage(entry.fileName))
                    count ++;
            });
            zipFile.on("end", function() {
                console.log(comic,"found",count,"pages");
                res.json({Pages:count});
            });
        }
    });
}

function countPagesCBR(comic, res) {
    var extractor = unrar.createExtractorFromFile(comic, config.cacheDirectory);
    let count = 0;
    if (extractor) {
        var list = extractor.getFileList();
        if (list[0].state === "SUCCESS") {
            for (let i = 0;list[1].fileHeaders[i];i ++) {
                if (isImage(list[1].fileHeaders[i].name))
                    count ++;
            }
            console.log(comic,"found",count,"pages");
            res.json({Pages:count});

            return;
        }
    }
    console.log("Unable to extract",comic,"error:", extractor);
    res.json({Pages:0});
}

function getCachedName(base) {
    base = joinPaths(config.cacheDirectory, base);

    var cached = base + ".jpg";
    if (fs.existsSync(cached))
        return cached;

    cached = base + ".jpeg"
    if (fs.existsSync(cached))
        return cached;

    cached = base + ".png"
    if (fs.existsSync(cached))
        return cached;

    cached = base + ".gif"
    if (fs.existsSync(cached))
        return cached;

    cached = base + ".bmp"
    if (fs.existsSync(cached))
        return cached;

    cached = "";

    return cached;
}

function generatePage(comic, page, res, saveFolderIcon) {
    console.log("loading page for ", comic, page);

    var base=comic.hashCode();
    var cached = getCachedName(base + "_" + page);

    if (!fileAccess[base]) {
        fileAccess[base] = locks.createMutex();
    }

    // Prevent more than one "thread" from accessing a single cbz/cbr file at a time
    fileAccess[base].lock(function () {
        if (!cached) {
            console.log("  Extracting from ",base, comic);
            if (comic.toUpperCase().endsWith(".CBZ")) {
                generatePageCBZ(comic, page, false, res, saveFolderIcon);
            }
            if (comic.toUpperCase().endsWith(".CBR")) {
                generatePageCBR(comic, page, false, res, saveFolderIcon);
            }
        } else {
            console.log("Found existing cached entry for: ", cached, comic);
            if (saveFolderIcon && (cached.toUpperCase().endsWith(".JPG") || cached.toUpperCase().endsWith(".JPEG"))) {
                console.log("Creating work request for cached image",cached);
                let folderIcon = joinPaths(saveFolderIcon, "folder.jpg");
                folderBuilder.push({folderJPG:folderIcon,sourceJPG:cached,response:[res]});
            } else
                returnFile(cached, res);
            fileAccess[base].unlock();
        }
    });

    setTimeout(function () {
        if (fileAccess[base]) {
            fileAccess[base].lock(function() {
                fileAccess[base].unlock();
                delete fileAccess[base];
            });
        }
    },300000);
}

function saveImage(zipFile, entry, cached, saveFolderIcon, res) {
    zipFile.openReadStream(entry, function(err, readStream) {
        if (err) {
            console.log("Unable to read entry",curPage,"error ",err);
            zipFile.close();
        } else {
            var writeStream = fs.createWriteStream(cached);
            writeStream.on('close', function() {
                if (saveFolderIcon && (entry.fileName.toUpperCase().endsWith(".JPG") || entry.fileName.toUpperCase().endsWith(".JPEG"))) {
                    let folderIcon = joinPaths(saveFolderIcon, "folder.jpg");
                    console.log("Finished saving",cached," from ",entry.fileName);
                    folderBuilder.push({folderJPG:folderIcon,sourceJPG:cached,response:[res]});
                }
                else if (res) {
                    returnFile(cached, res);
                }
            });
            readStream.on('error', function(err) {
                console.log("Error reading stream:", err);
                if (res)
                    res.status(404).send("not found");
                zipFile.close();
            });
            readStream.on('end', function() {
                if (saveFolderIcon)
                    zipFile.close();
                else
                    zipFile.readEntry();
            });

            // Save the entry from the zipfile to the disk
            readStream.pipe(writeStream);
        }
    });
}

function generatePageCBZ(comic, page, retry, res, saveFolderIcon) {
    var curPage = 1;
    var base=comic.hashCode();

    yauzl.open(comic, {lazyEntries: true, validateEntrySizes: false}, function(err, zipFile) {
        if (err) {
            console.log("Error opening cbz:",comic,err);
            res.status(404).send("not found");
            fileAccess[base].unlock();
        }
        else {
            zipFile.on("error", function(error) {
                console.log("Error event", error);
                zipFile.close();
            });
            zipFile.on("end", function(error) {
                zipFile.close();
            });
            zipFile.on("entry", function(entry) {
                //fs.createReadStream(comic).pipe(unzip.Parse()).on('entry',function (entry) {
                //console.log("ZIP:",comic,"zipFile",zipFile,"Entry:",entry);
                if (isImage(entry.fileName)) {
                    let ext = extExtract.exec(entry.fileName)[1].toLowerCase();
                    let cached = joinPaths(config.cacheDirectory, base + "_" + curPage + "." + ext);
                    if (curPage == page) {
                        console.log("Beginning to save",cached);
                        saveImage(zipFile, entry, cached, saveFolderIcon, res);
                    }
                    else if (!saveFolderIcon) {
                        saveImage(zipFile, entry, cached, null, null);
                    }
                    curPage ++;
                }
                else
                    zipFile.readEntry();
            });
            zipFile.on("close",function() {
                console.log("Finished reading",comic);
                fileAccess[base].unlock();
            });

            // Read the first entry
            zipFile.readEntry();
        }
    });
}

function generatePageCBR(comic, page, retry, res, saveFolderIcon) {
    var curPage = 0;
    var base=comic.hashCode();
    var extractor = unrar.createExtractorFromFile(comic, config.cacheDirectory);
    if (extractor) {
        var list = extractor.extractAll();
        if (list[0].state === "SUCCESS") {
            // Make sure pages are in order
            list[1].files.sort(function (a,b) {
                if (a.fileHeader.name < b.fileHeader.name)
                    return -1;
                else if (a.fileHeader.name > b.fileHeader.name)
                    return 1;
                return 0;
            });
            
            for (let i = 0;list[1].files[i];i ++) {
                let file = list[1].files[i].fileHeader;
                if (isImage(file.name)) {
                    curPage ++;
                    let ext = extExtract.exec(file.name)[1].toLowerCase();
                    let cached = joinPaths(config.cacheDirectory, base + "_" + curPage + "." + ext);

                    fs.renameSync(joinPaths(config.cacheDirectory,file.name),cached);

                    if (curPage == page) {
                        if (saveFolderIcon && (ext.endsWith(".jpg") || ext.endsWith(".jpeg"))) {
                            let folderIcon = joinPaths(saveFolderIcon, "folder.jpg");
                            folderBuilder.push({folderJPG:folderIcon,sourceJPG:cached,response:[res]});
                        }
                        else if (res)
                            returnFile(cached, res);
                    }
                }
            }
        }
    }

    console.log("Finished reading",comic);
    fileAccess[base].unlock();
}

function returnFile(comic, res) {
    fs.readFile(comic, function(err, data) {
        if (data.length == 0) {
            fs.unlink(comic); // Image isn't valid, remove it
        }

        res.writeHead(200, {'Content-Type': 'image/jpeg'});
        res.end(data); // Send the file data to the browser.
    });
}

// all of our routes will be prefixed with /api
app.use('/api', router);

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});
  