Install dejavu-fonts

```
git clone https://github.com/web-fonts/dejavu-sans
```

Install emscripten.  
Build ffmpeg.js with GIF support from this repo:

```
git clone https://github.com/wilkie/ffmpeg.js
cd ffmpeg.js
emmake ffmpeg-worker-gif.js
```

Run a static server:

```
ruby -run -e httpd . -p 8080
```

Navigate to browser

```
http://localhost:8080
```
