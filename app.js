var VIDEO_EXTENSIONS     = ["mkv", "avi", "mp4"];
var SUBTITLE_EXTENSIONS  = ["sub", "srt"];
var INDEX_EXTENSIONS     = ["idx"];

/* Measures text
 */
var measureText = function(ctx, font, text) {
  var textMetrics = ctx.measureText(text);

  var fontCheck = font.replace(new RegExp("\"", 'g'), "")

  var measureDiv = document.querySelector("div.output .textMeasure[data-font=\"" + fontCheck + "\"]");

  if (!measureDiv) {
    var text = document.createElement("span");
    text.textContent = "Hg";
    text.style.font = font;
    var block = document.createElement("div");
    block.style.display = "inline-block";
    block.style.width = "1px";
    block.style.height = "0px";

    var div = document.createElement("div");
    div.classList.add("textMeasure");
    div.setAttribute("data-font", fontCheck);
    div.style.position = 'absolute';
    div.style.opacity = 0;
    div.appendChild(text);
    div.appendChild(block);

    var output = document.querySelector('div.output .gifs');
    output.appendChild(div);

    block.style.verticalAlign = "baseline";
    var blockRect = block.getBoundingClientRect();
    var textRect  = text.getBoundingClientRect()

    var textAscent = blockRect.top - textRect.top;

    block.style.verticalAlign = "bottom";
    blockRect = block.getBoundingClientRect();
    textRect  = text.getBoundingClientRect()

    var textHeight = blockRect.top - textRect.top;
    var textDescent = textHeight - textAscent;

    div.setAttribute("data-text-ascent",  textAscent);
    div.setAttribute("data-text-height",  textHeight);
    div.setAttribute("data-text-descent", textDescent);
    measureDiv = div;
  }

  textMetrics.height  = parseInt(measureDiv.getAttribute("data-text-height"));
  textMetrics.ascent  = parseInt(measureDiv.getAttribute("data-text-ascent"));
  textMetrics.descent = parseInt(measureDiv.getAttribute("data-text-descent"));

  return textMetrics;
};

var ffmpeg = function(inputs, args, callback, stdoutCallback, stderrCallback) {
  var terminal = document.querySelector('pre');
  terminal.innerHTML = "";

  console.log(args);
  // Look at inputs
  var workerFSInputs = [];
  var memFSInputs = [];
  var blobs = [];

  inputs.forEach(function(input) {
    if (input instanceof File) {
      workerFSInputs.push(input);
    }
    else if (input.data && input.data instanceof Blob) {
      blobs.push(input);
    }
    else {
      console.log("memfs", input);
      memFSInputs.push(input);
    }
  });

  var worker = new Worker("ffmpeg-worker-gif.js");
  worker.onmessage = function(e) {
    var msg = e.data;
    switch (msg.type) {
      case "ready":
        worker.postMessage({
          type: "run",
          MEMFS: memFSInputs,
          mounts: [{
            type: "WORKERFS",
            opts: {
              files: workerFSInputs,
            },
            mountpoint: "/input"
          },{
            type: "WORKERFS",
            opts: {
              blobs: blobs
            },
            mountpoint: "/data"
          }],
          arguments: args
        });
        break;
      case "stdout":
        if (stdoutCallback) {
          stdoutCallback(msg.data);
          break;
        }
      case "stderr":
        if (stdoutCallback) {
          stderrCallback(msg.data);
        }

        var maxScroll = terminal.scrollHeight - terminal.clientHeight;
        var autoScroll = (terminal.scrollTop >= maxScroll - 0.5);
        terminal.innerHTML += msg.data + "\n";
        if (autoScroll) {
          terminal.scrollTop = terminal.scrollHeight - terminal.clientHeight;
        }
        break;
      case "done":
      case "exit":
        console.log(msg);
        console.log("process exited with code " + msg.data);
        worker.terminate();

        callback(msg.data.MEMFS);
        break;
    }
  };
};

var fileToPNG = function(file) {
  var pngData = file.data;
  var pngBlob = new Blob([pngData], {'type': 'image/png'});
  if (pngBlob) {
    return (URL || webkitURL).createObjectURL(pngBlob);
  }
  else {
    var pngB64  = btoa(String.fromCharCode.apply(null, pngData));
    return 'data:image/png;base64,' + pngB64;
  }
};

var fileToGIF = function(file) {
  var gifData = file.data;
  var gifBlob = new Blob([gifData], {'type': 'image/gif'});
  if (gifBlob) {
    return (URL || webkitURL).createObjectURL(gifBlob);
  }
  else {
    var gifB64  = btoa(String.fromCharCode.apply(null, gifData));
    return 'data:image/gif;base64,' + gifB64;
  }
};

var input = document.querySelector('input[type="file"]');
if (input) {
  // React when files are chosen
  input.addEventListener("change", function(event) {
    // Determine video file by extension (or if there is only one file)
    var videoFile = null;
    Array.prototype.forEach.call(input.files, function(file) {
      if (file.name.length > 4) {
        var extension = file.name.substring(file.name.length - 3);
        if (VIDEO_EXTENSIONS.includes(extension)) {
          videoFile = file;
        }
      }
    });

    if (videoFile === null) {
      throw "unknown video format";
    }

    // Do the same for any subtitle files
    var subtitleFile = null;
    Array.prototype.forEach.call(input.files, function(file) {
      if (file.name.length > 4) {
        var extension = file.name.substring(file.name.length - 3);
        if (SUBTITLE_EXTENSIONS.includes(extension)) {
          subtitleFile = file;
        }
      }
    });

    // And index files
    var indexFile = null;
    Array.prototype.forEach.call(input.files, function(file) {
      if (file.name.length > 4) {
        var extension = file.name.substring(file.name.length - 3);
        if (INDEX_EXTENSIONS.includes(extension)) {
          indexFile = file;
        }
      }
    });

    // Keeping track of video metadata
    var metadata = {};

    // Track the files that will be mounted in the web worker
    var fileList = [videoFile];
    console.log("Decoding video:", videoFile.name);

    var subtitleFilename = videoFile.name;
    if (subtitleFile) {
      console.log("With subtitles:", subtitleFile.name);
      subtitleFilename = subtitleFile.name;
      fileList.push(subtitleFile);
    }

    var indexFilename = null;
    if (indexFile) {
      console.log("With subtitle index:", indexFile.name);
      indexFilename = indexFile.name;
      fileList.push(indexFile);
    }

    // Declare the font (TODO: move to a configurable option)
    var font = "14pt \"DejaVu Sans\"";

    // If we need the subtitles... attempt to extract them from the video file
    // We want to do this for every few seconds of video
    console.log("Parsing video for subtitles");
    // TODO: just parse the SRT if one is given

    var subtitles = [];
    var subtitleArgs = [];
    if (subtitleFile) {
    }
    if (indexFile) {
    }
    ffmpeg(fileList,
           ["-hide_banner", "-i", "/input/" + subtitleFile.name].concat(subtitleArgs).concat(["-map", "0:s:0", "-f", "srt", "-"]),
           function(outputs) {
           },
           function(stdout) {
             Array.prototype.push.apply(subtitles, stdout.split("\n"));
             var start = 0
             subtitles.forEach(function(line, i) {
               if (line.trim() == "") {
                 consumeSubtitles(videoFile, metadata, font, subtitles.slice(0, i-start));
                 subtitles = subtitles.slice(i-start+1);
                 start = i;
               }
             });
           },
           function(stderr) {
             if (!metadata.size) {
               stderr.split("\n").forEach(function(line) {
                 var matches = line.match(/Stream #0.*?\s(\d+)x(\d+)\s/);
                 if (matches && matches[1]) {
                   // Getting the size of the video
                   metadata.size = {};
                   metadata.size.width  = parseInt(matches[1]);
                   metadata.size.height = parseInt(matches[2]);
                 }
               });
             }
           }
    );
  });
}

var parseTimestamp = function(timestamp) {
  return timestamp.trim().replace(",", ".");
};

var timestampToMS = function(timestamp) {
  return (new Date("1970-01-01T" + timestamp + "Z")).getTime();
};

var msToTimestamp = function(ms) {
  // The SRT timestamp is really part of an ISO date
  // so this little hack will help us calculate time ranges
  var ret = (new Date(ms)).toISOString();
  return ret.substring(ret.length - 13, ret.length - 1);
};

var timestampDifference = function(start, end) {
  start = timestampToMS(start);
  end   = timestampToMS(end);

  return msToTimestamp(end - start);
};

var consumeSubtitles = function(videoFile, metadata, font, subtitles) {
  // Create entry
  var subtitlesList = document.querySelector(".output .subtitles");
  var subtitleEntry = document.createElement("li");
  subtitleEntry.textContent = subtitles.slice(2).join(" ").replace("\n", " ").replace("\r", " ");
  subtitlesList.appendChild(subtitleEntry);

  var times = subtitles[1].split("-->");
  var start = parseTimestamp(times[0]);
  var end   = parseTimestamp(times[1]);
  subtitleEntry.setAttribute("data-start", start);
  subtitleEntry.setAttribute("data-end", end);
  subtitleEntry.setAttribute("data-text", subtitles.slice(2).join("\n"));
  subtitleEntry.addEventListener("click", function(event) {
    // Render GIF at start for duration end-start, with subtitle text
    var start = this.getAttribute("data-start");
    var end   = this.getAttribute("data-end");
    var text  = this.getAttribute("data-text");

    addPotentialGIF(videoFile, metadata, start, end, text, font);
  });
};

var ensureFontIsLoaded = function(font) {
  var fontCheck = font.replace(new RegExp("\"", 'g'), "")

  // Ensure font loads (what a gross weird web-only problem)
  var div = document.querySelector(".output .fontImport[font=\"" + fontCheck + "\"]");
  if (!div) {
    div = document.createElement("div");
    div.classList.add("fontImport");
    div.setAttribute("data-font", fontCheck);
    div.style.font = font;
    div.style.opacity = 0;
    div.style.position = "absolute";
    div.textContent = "M";
    var output = document.querySelector(".output .gifs");
    output.appendChild(div);
  }
};

var addPotentialGIF = function(videoFile, metadata, start, end, text, font) {
  // Create the placeholder in the gif output pane
  var gifTemplate = document.querySelector(".output .gifs template");
  if ('content' in gifTemplate) {
    var outputBlock = document.importNode(gifTemplate.content, true);
    outputBlock = outputBlock.querySelector("li");
  }
  else {
    outputBlock = gifTemplate.querySelector("li").cloneNode(true);
  }

  // Represent the size (which can be changed, of course)
  var videoWidth  = ((metadata.size || {}).width  || 1920);
  var videoHeight = ((metadata.size || {}).height || 1080); 
  var originalGifWidth = 400;
  var gifWidth = originalGifWidth;
  outputBlock.style.width  = gifWidth + "px";
  outputBlock.style.height = ((videoHeight/videoWidth) * gifWidth) + "px";

  var output = document.querySelector(".output .gifs");
  output.appendChild(outputBlock);

  // Make sure the DOM uses the font
  ensureFontIsLoaded(font);

  var textarea = outputBlock.querySelector("textarea");
  textarea.style.font  = font;
  textarea.style.color = "white";
  textarea.textContent = text;

  var inputStart = outputBlock.querySelector("input.start");
  var inputEnd   = outputBlock.querySelector("input.end");
  inputStart.setAttribute("value", start);
  inputEnd.setAttribute("value", end);

  // Bind widget events
  outputBlock.querySelector("button.smallen")
             .addEventListener("click", function(event) {
    gifWidth -= 10;
    outputBlock.style.width  = gifWidth + "px";
    outputBlock.style.height = ((videoHeight/videoWidth) * gifWidth) + "px";
  });
  outputBlock.querySelector("button.biggen")
             .addEventListener("click", function(event) {
    gifWidth += 10;
    outputBlock.style.width  = gifWidth + "px";
    outputBlock.style.height = ((videoHeight/videoWidth) * gifWidth) + "px";
  });
  outputBlock.querySelector("button.normen")
             .addEventListener("click", function(event) {
    gifWidth = originalGifWidth;
    outputBlock.style.width  = gifWidth + "px";
    outputBlock.style.height = ((videoHeight/videoWidth) * gifWidth) + "px";
  });
  outputBlock.querySelector("button.rewindStart")
             .addEventListener("click", function(event) {
    var newStart = timestampToMS(inputStart.getAttribute("value"));
    newStart = Math.max(newStart - 100, 0);
    inputStart.setAttribute("value", msToTimestamp(newStart));
  });
  outputBlock.querySelector("button.forwardStart")
             .addEventListener("click", function(event) {
    var newStart = timestampToMS(inputStart.getAttribute("value"));
    newStart += 100;
    inputStart.setAttribute("value", msToTimestamp(newStart));
  });
  outputBlock.querySelector("button.rewindEnd")
             .addEventListener("click", function(event) {
    var newEnd = timestampToMS(inputEnd.getAttribute("value"));
    newEnd = Math.max(newEnd - 100, 0);
    inputEnd.setAttribute("value", msToTimestamp(newEnd));
  });
  outputBlock.querySelector("button.forwardEnd")
             .addEventListener("click", function(event) {
    var newEnd = timestampToMS(inputEnd.getAttribute("value"));
    // TODO: put video duration in metadata and detect invalid range
    newEnd += 100;
    inputEnd.setAttribute("value", msToTimestamp(newEnd));
  });
  outputBlock.querySelector("button.remove")
             .addEventListener("click", function(event) {
    outputBlock.remove();
  });
  outputBlock.querySelector("button.generate")
             .addEventListener("click", function(event) {
    var updatedText  = textarea.value;
    var updatedStart = inputStart.getAttribute("value");
    var updatedEnd   = inputEnd.getAttribute("value");

    outputBlock.querySelectorAll("button").forEach(function(element) {
      element.remove();
    });
    outputBlock.querySelectorAll("input").forEach(function(element) {
      element.remove();
    });

    // When the person is happy (or even if they aren't, I suppose), generate:
    generateGIF(outputBlock, videoFile, metadata, gifWidth, updatedStart, updatedEnd, updatedText, font);
  });
};

var generateGIF = function(outputBlock, videoFile, metadata, gifWidth, start, end, subtitles, font) {
  var fileList = [videoFile];

  // Get the duration as a timestamp
  var duration = timestampDifference(start, end);

  // Spawn a ffmpeg process (to create the gif palette)
  ffmpeg(fileList,
         ["-hide_banner", "-y", "-ss", start, "-i", "/input/" + videoFile.name, "-t", duration, "-vf", "fps=15,scale=" + gifWidth + ":-1:flags=lanczos", "frame-%05d.png"],
         function(outputs) {
           blobs = [];

           /* Draw Subtitles using canvas */

           outputs.forEach(function(file, i) {
             var image = document.createElement("img");
             var canvas = document.createElement("canvas");
             image.addEventListener("load", function(event) {
               var imageWidth  = image.clientWidth;
               var imageHeight = image.clientHeight;

               canvas.width  = imageWidth;
               canvas.height = imageHeight;

               var ctx = canvas.getContext('2d');
               ctx.drawImage(image, 0, 0);
               ctx.textAlign = "left";
               ctx.textBaseline = "top";
               ctx.font = font;

               var lines = subtitles.split("\n");
               lines.forEach(function(text, i) {
                 var x, y;
                 var textMetrics = measureText(ctx, font, text);
                 x = (imageWidth / 2) - (textMetrics.width / 2);
                 y = imageHeight - ((textMetrics.height) * (lines.length - i)) - 5;
                 ctx.fillStyle = "white";
                 ctx.strokeStyle = "#444";
                 ctx.strokeText(text, x, y);
                 ctx.fillText(text, x, y);
               });
               canvas.toBlob(function(blob) {
                 // Destroy the image and the canvas
                 image.remove();
                 canvas.remove();

                 blobs.push({
                   "name": file.name,
                   "data": blob
                 });

                 if (blobs.length == outputs.length) {
                   /* Feed resulting images back to ffmpeg */
                   /* Render result */
                   fileList = blobs;

                   ffmpeg(fileList,
                          ["-hide_banner", "-y", "-i", "/data/frame-%05d.png", "-vf", "fps=15,scale=" + gifWidth + ":-1:flags=lanczos,palettegen", "palette.png"],
                          function(outputs) {
                            var paletteFile = outputs[0];

                            fileList.push(paletteFile);
                            ffmpeg(fileList, 
                                   ["-hide_banner", "-i", "/data/frame-%05d.png", "-copyts", "-i", paletteFile.name, "-filter_complex", "fps=15,scale="+ gifWidth + ":-1:flags=lanczos[x];[x][1:v]paletteuse", "output.gif"],
                                   function(outputs) {
                                     var image = document.createElement("img");
                                     outputBlock.appendChild(image);

                                     image.src = fileToGIF(outputs[0])
                                   }
                             );
                          }
                   );
                 }
               }, "image/png");
             });
             image.src = fileToPNG(file)

             var scratch = document.querySelector('div.scratch');
             scratch.appendChild(image);
           });
         }
  );
  /*
  ffmpeg(fileList,
         ["-hide_banner", "-y", "-ss", "439", "-t", "4", "-i", "/input/" + videoFile.name, "-vf", "fps=10,scale=400:-1:flags=lanczos,palettegen" + subtitleArguments, "palette.png"],
         function(outputs) {
           var paletteFile = outputs[0];

           fileList.push(paletteFile);

           ffmpeg(fileList, 
                  ["-hide_banner", "-ss", "439", "-t", "4", "-i", "/input/" + videoFile.name, "-copyts", "-i", paletteFile.name, "-filter_complex", "fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" + subtitleArguments, "output.gif"],
                  function(outputs) {
                    var image = document.createElement("img");
                    output.appendChild(image);

                    var gifFile = outputs[0];
                    var gifData = gifFile.data;
                    var gifBlob = new Blob([gifData], {'type': 'image/gif'});
                    if (gifBlob) {
                      image.src = (URL || webkitURL).createObjectURL(gifBlob);
                    }
                    else {
                      var gifB64  = btoa(String.fromCharCode.apply(null, gifData));
                      image.src = 'data:image/gif;base64,' + gifB64;
                    }
                  }
           );
         }
  );*/
}
