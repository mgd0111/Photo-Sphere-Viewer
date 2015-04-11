/*!
 * Photo Sphere Viewer 3.0.0
 * Copyright (c) 2014-2015 Jérémy Heleine
 * Copyright (c) 2015 Damien "Mistic" Sorel
 * Licensed under MIT (http://opensource.org/licenses/MIT)
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['three'], factory);
    }
    else {
        root.PhotoSphereViewer = factory(root.THREE);
    }
}(this, function(THREE) {
"use strict";

/**
 * Viewer class
 * @param args (Object) Viewer settings
 * - panorama (string) Panorama URL or path (absolute or relative)
 * - container (HTMLElement) Panorama container (should be a div or equivalent)
 * - caption (string) (optional) (null) Text displayed in the navbar
 * - autoload (boolean) (optional) (true) true to automatically load the panorama, false to load it later (with the .load() method)
 * - usexmpdata (boolean) (optional) (true) true if Photo Sphere Viewer must read XMP data, false if it is not necessary
 * - min_fov (number) (optional) (30) The minimal field of view, in degrees, between 1 and 179
 * - max_fov (number) (optional) (90) The maximal field of view, in degrees, between 1 and 179
 * - default_fov (number) (optional) (max_fov) The default field of view, in degrees, between min_fov and max_fov
 * - default_long (number) (optional) (0) The default longitude, in radians, between 0 and 2xPI
 * - default_lat (number) (optional) (0) The default latitude, in radians, between -PI/2 and PI/2
 * - long_offset (number) (optional) (PI/360) The longitude to travel per pixel moved by mouse/touch
 * - lat_offset (number) (optional) (PI/180) The latitude to travel per pixel moved by mouse/touch
 * - time_anim (integer) (optional) (2000) Delay before automatically animating the panorama in milliseconds, false to not animate
 * - anim_speed (string) (optional) (2rpm) Animation speed in radians/degrees/revolutions per second/minute
 * - navbar (boolean) (optional) (false) Display the navigation bar if set to true
 * - loading_img (string) (optional) (null) Loading image URL or path (absolute or relative)
 * - size (Object) (optional) (null) Final size of the panorama container (e.g. {width: 500, height: 300})
 */
var PhotoSphereViewer = function(options) {
  if (options === undefined || options.panorama === undefined || options.container === undefined) {
    throw 'PhotoSphereViewer: no value given for panorama or container';
  }

  this.config = PSVUtils.deepmerge(PhotoSphereViewer.DEFAULTS, options);

  // normalize config
  this.config.min_fov = PSVUtils.stayBetween(this.config.min_fov, 1, 179);
  this.config.max_fov = PSVUtils.stayBetween(this.config.max_fov, 1, 179);
  if (this.config.default_fov === null) {
    this.config.default_fov = this.config.max_fov;
  }
  else {
    this.config.default_fov = PSVUtils.stayBetween(this.config.default_fov, this.config.min_fov, this.config.max_fov);
  }

  // references to components
  this.container = this.config.container;
  this.loader = null;
  this.navbar = null;
  this.canvas_container = null;
  this.renderer = null;
  this.scene = null;
  this.camera = null;
  this.actions = {};

  // local properties
  this.prop = {
    fps: 60,
    phi: 0,
    theta: 0,
    theta_offset: 0,
    zoom_lvl: 0,
    mousedown: false,
    mouse_x: 0,
    mouse_y: 0,
    autorotate_timeout: null,
    anim_timeout: null,
    size: {
      width: 0,
      height: 0,
      ratio: 0
    }
  };

  // compute zoom level
  this.prop.zoom_lvl = Math.round((this.config.default_fov - this.config.min_fov) / (this.config.max_fov - this.config.min_fov) * 100);
  this.prop.zoom_lvl-= 2* (this.prop.zoom_lvl - 50);

  // init
  this.setAnimSpeed(this.config.anim_speed);

  this.rotate(this.config.default_long, this.config.default_lat);

  if (this.config.size !== null) {
    this._setViewerSize(this.config.size);
  }

  if (this.config.autoload) {
    this.load();
  }
};

/**
 * PhotoSphereViewer defaults
 */
PhotoSphereViewer.DEFAULTS = {
  panorama: null,
  container: null,
  caption: null,
  autoload: true,
  usexmpdata: true,
  min_fov: 30,
  max_fov: 90,
  default_fov: null,
  default_long: 0,
  default_lat: 0,
  long_offset: Math.PI / 720.0,
  lat_offset: Math.PI / 360.0,
  time_anim: 2000,
  anim_speed: '2rpm',
  navbar: false,
  loading_img: null,
  size: null
};

/**
 * Starts to load the panorama
 * @return (void)
 */
PhotoSphereViewer.prototype.load = function() {
  PSVUtils.addClass(this.container, 'psv-container loading');

  // Is canvas supported?
  if (!PSVUtils.isCanvasSupported()) {
    this.container.textContent = 'Canvas is not supported, update your browser!';
    return;
  }

  // Loading indicator (text or image if given)
  if (!!this.config.loading_img) {
    this.loader = document.createElement('img');
    this.loader.src = this.config.loading_img;
    this.loader.alt = 'Loading...';
  }
  else {
    this.loader = document.createElement('div');
    this.loader.textContent = 'Loading...';
  }
  this.loader.className = 'psv-loader';
  this.container.appendChild(this.loader);

  // Canvas container
  this.canvas_container = document.createElement('div');
  this.canvas_container.className = 'psv-canvas';
  this.container.appendChild(this.canvas_container);

  // Navigation bar
  if (this.config.navbar) {
    this.navbar = new PSVNavBar(this);
    this.container.appendChild(this.navbar.getBar());
  }

  // Adding events
  PSVUtils.addEvent(window, 'resize', this._onResize.bind(this));
  PSVUtils.addEvent(this.canvas_container, 'mousedown', this._onMouseDown.bind(this));
  PSVUtils.addEvent(this.canvas_container, 'touchstart', this._onTouchStart.bind(this));
  PSVUtils.addEvent(document, 'mouseup', this._onMouseUp.bind(this));
  PSVUtils.addEvent(document, 'touchend', this._onMouseUp.bind(this));
  PSVUtils.addEvent(document, 'mousemove', this._onMouseMove.bind(this));
  PSVUtils.addEvent(document, 'touchmove', this._onTouchMove.bind(this));
  PSVUtils.addEvent(this.canvas_container, 'mousewheel', this._onMouseWheel.bind(this));
  PSVUtils.addEvent(this.canvas_container, 'DOMMouseScroll', this._onMouseWheel.bind(this));
  PSVUtils.addEvent(document, 'fullscreenchange', this._fullscreenToggled.bind(this));
  PSVUtils.addEvent(document, 'mozfullscreenchange', this._fullscreenToggled.bind(this));
  PSVUtils.addEvent(document, 'webkitfullscreenchange', this._fullscreenToggled.bind(this));
  PSVUtils.addEvent(document, 'MSFullscreenChange', this._fullscreenToggled.bind(this));

  // load image
  if (this.config.usexmpdata) {
    this._loadXMP();
  }
  else {
    this._createBuffer(false);
  }
};

/**
 * Loads the XMP data with AJAX
 * @return (void)
 */
PhotoSphereViewer.prototype._loadXMP = function() {
  var xhr = null;
  var self = this;

  if (window.XMLHttpRequest) {
    xhr = new XMLHttpRequest();
  }
  else if (window.ActiveXObject) {
    try {
      xhr = new ActiveXObject('Msxml2.XMLHTTP');
    }
    catch (e) {
      xhr = new ActiveXObject('Microsoft.XMLHTTP');
    }
  }
  else {
    this.container.textContent = 'XHR is not supported, update your browser!';
    return;
  }

  xhr.onreadystatechange = function() {
    if (xhr.readyState == 4 && xhr.status == 200) {
      var binary = xhr.responseText;
      var a = binary.indexOf('<x:xmpmeta'), b = binary.indexOf('</x:xmpmeta>');
      var data = binary.substring(a, b);

      // No data retrieved
      if (a == -1 || b == -1 || data.indexOf('GPano:') == -1) {
        self._createBuffer(false);
        return;
      }

      var pano_data = {
        full_width: parseInt(PSVUtils.getAttribute(data, 'FullPanoWidthPixels')),
        full_height: parseInt(PSVUtils.getAttribute(data, 'FullPanoHeightPixels')),
        cropped_width: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaImageWidthPixels')),
        cropped_height: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaImageHeightPixels')),
        cropped_x: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaLeftPixels')),
        cropped_y: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaTopPixels')),
      };

      self._createBuffer(pano_data);
    }
  };

  xhr.open('GET', this.config.panorama, true);
  xhr.send(null);
};

/**
 * Creates an image in the right dimensions
 * @param pano_data (mixed) An object containing the panorama XMP data (false if it there is not)
 * @return (void)
 */
PhotoSphereViewer.prototype._createBuffer = function(pano_data) {
  var img = new Image();
  var self = this;

  img.onload = function() {
    // Default XMP data
    if (!pano_data) {
      pano_data = {
        full_width: img.width,
        full_height: img.height,
        cropped_width: img.width,
        cropped_height: img.height,
        cropped_x: 0,
        cropped_y: 0,
      };
    }

    // Size limit for mobile compatibility
    var max_width = 2048;
    if (PSVUtils.isWebGLSupported()) {
      max_width = PSVUtils.getMaxTextureWidth();
    }

    // Buffer width
    var new_width = Math.min(pano_data.full_width, max_width);
    var r = new_width / pano_data.full_width;

    pano_data.full_width = new_width;
    pano_data.cropped_width *= r;
    pano_data.cropped_x *= r;
    img.width = pano_data.cropped_width;

    // Buffer height
    pano_data.full_height *= r;
    pano_data.cropped_height *= r;
    pano_data.cropped_y *= r;
    img.height = pano_data.cropped_height;

    // Create buffer
    var buffer = document.createElement('canvas');
    buffer.width = pano_data.full_width;
    buffer.height = pano_data.full_height;

    var ctx = buffer.getContext('2d');
    ctx.drawImage(img, pano_data.cropped_x, pano_data.cropped_y, pano_data.cropped_width, pano_data.cropped_height);

    self._loadTexture(buffer.toDataURL('image/jpeg'));
  };

  // CORS when the panorama is not given as a base64 string
  if (!this.config.panorama.match(/^data:image\/[a-z]+;base64/)) {
    img.setAttribute('crossOrigin', 'anonymous');
  }

  img.src = this.config.panorama;
};

/**
 * Loads the sphere texture
 * @param data (string) Image data ofthe panorama
 * @return (void)
 */
PhotoSphereViewer.prototype._loadTexture = function(data) {
  var texture = new THREE.Texture();
  var loader = new THREE.ImageLoader();
  var self = this;

  loader.load(data, function(img) {
    texture.needsUpdate = true;
    texture.image = img;

    self._createScene(texture);
  });
};

/**
 * Creates the 3D scene
 * @param texture (THREE.Texture) The sphere texture
 * @return (void)
 */
PhotoSphereViewer.prototype._createScene = function(texture) {
  this._onResize();

  // Renderer depends on whether WebGL is supported or not
  this.renderer = PSVUtils.isWebGLSupported() ? new THREE.WebGLRenderer() : new THREE.CanvasRenderer();
  this.renderer.setSize(this.prop.size.width, this.prop.size.height);

  this.camera = new THREE.PerspectiveCamera(this.config.default_fov, this.prop.size.ratio, 1, 300);
  this.camera.position.set(0, 0, 0);

  this.scene = new THREE.Scene();
  this.scene.add(this.camera);

  var geometry = new THREE.SphereGeometry(200, 32, 32);
  var material = new THREE.MeshBasicMaterial({map: texture, overdraw: true});
  var mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = -1;
  this.scene.add(mesh);

  this.canvas_container.appendChild(this.renderer.domElement);

  // Remove loader
  this.container.removeChild(this.loader);
  PSVUtils.removeClass(this.container, 'loading');

  // Queue animation
  if (this.config.time_anim !== false) {
    this.prop.anim_timeout = setTimeout(this.startAutorotate.bind(this), this.config.time_anim);
  }

  this.trigger('ready');
  this.render();
};

/**
 * Renders an image
 * @return (void)
 */
PhotoSphereViewer.prototype.render = function() {
  var point = new THREE.Vector3();
  point.setX(Math.cos(this.prop.phi) * Math.sin(this.prop.theta));
  point.setY(Math.sin(this.prop.phi));
  point.setZ(Math.cos(this.prop.phi) * Math.cos(this.prop.theta));

  this.camera.lookAt(point);
  this.renderer.render(this.scene, this.camera);
};

/**
 * Automatically rotates the panorama
 * @return (void)
 */
PhotoSphereViewer.prototype._autorotate = function() {
  // Rotates the sphere && Returns to the equator (phi = 0)
  this.rotate(
    this.prop.theta - this.prop.theta_offset - Math.floor(this.prop.theta / (2.0 * Math.PI)) * 2.0 * Math.PI,
    this.prop.phi - this.prop.phi / 200
  );

  this.prop.autorotate_timeout = setTimeout(this._autorotate.bind(this), 1000 / this.prop.fps);
};

/**
 * Starts the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.startAutorotate = function() {
  this._autorotate();
  this.trigger('autorotate', true);
};

/**
 * Stops the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.stopAutorotate = function() {
  clearTimeout(this.prop.anim_timeout);
  this.prop.anim_timeout = null;

  clearTimeout(this.prop.autorotate_timeout);
  this.prop.autorotate_timeout = null;

  this.trigger('autorotate', false);
};

/**
 * Launches/stops the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.toggleAutorotate = function() {
  clearTimeout(this.prop.anim_timeout);

  if (this.prop.autorotate_timeout) {
    this.stopAutorotate();
  }
  else {
    this.startAutorotate();
  }
};

/**
 * Resizes the canvas when the window is resized
 * @return (void)
 */
PhotoSphereViewer.prototype._onResize = function() {
  if (this.container.clientWidth != this.prop.size.width || this.container.clientHeight != this.prop.size.height) {
    this.resize(this.container.clientWidth, this.container.clientHeight);
  }
};

/**
 * Resizes the canvas
 * @param width (integer) The new canvas width
 * @param height (integer) The new canvas height
 * @return (void)
 */
PhotoSphereViewer.prototype.resize = function (width, height) {
  this.prop.size.width = parseInt(width);
  this.prop.size.height = parseInt(height);
  this.prop.size.ratio = this.prop.size.width / this.prop.size.height;

  if (this.camera) {
    this.camera.aspect = this.prop.size.ratio;
    this.camera.updateProjectionMatrix();
  }

  if (this.renderer) {
    this.renderer.setSize(this.prop.size.width, this.prop.size.height);
    this.render();
  }

  this.trigger('size-updated', this.prop.size.width, this.prop.size.height);
};

/**
 * The user wants to move
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseDown = function(evt) {
  this._startMove(parseInt(evt.clientX), parseInt(evt.clientY));
};

/**
 * The user wants to move (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onTouchStart = function(evt) {
  var touch = evt.changedTouches[0];
  if (touch.target.parentNode == this.canvas_container) {
    this._startMove(parseInt(touch.clientX), parseInt(touch.clientY));
  }
};

/**
 * Initializes the movement
 * @param x (integer) Horizontal coordinate
 * @param y (integer) Vertical coordinate
 * @return (void)
 */
PhotoSphereViewer.prototype._startMove = function(x, y) {
  this.prop.mouse_x = x;
  this.prop.mouse_y = y;

  this.stopAutorotate();

  this.prop.mousedown = true;
};

/**
 * The user wants to stop moving
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseUp = function(evt) {
  this.prop.mousedown = false;
};

/**
 * The user moves the image
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseMove = function(evt) {
  evt.preventDefault();
  this._move(parseInt(evt.clientX), parseInt(evt.clientY));
};

/**
 * The user moves the image (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onTouchMove = function(evt) {
  var touch = evt.changedTouches[0];
  if (touch.target.parentNode == this.canvas_container) {
    evt.preventDefault();
    this._move(parseInt(touch.clientX), parseInt(touch.clientY));
  }
};

/**
 * Movement
 * @param x (integer) Horizontal coordinate
 * @param y (integer) Vertical coordinate
 * @return (void)
 */
PhotoSphereViewer.prototype._move = function(x, y) {
  if (this.prop.mousedown) {
    this.rotate(
      this.prop.theta + (x - this.prop.mouse_x) * this.config.long_offset,
      this.prop.phi + (y - this.prop.mouse_y) * this.config.lat_offset
    );

    this.prop.mouse_x = x;
    this.prop.mouse_y = y;
  }
};

/**
 * Rotate the camera
 * @param x (integer) Horizontal angle (rad)
 * @param y (integer) Vertical angle (rad)
 * @return (void)
 */
PhotoSphereViewer.prototype.rotate = function(t, p) {
  this.prop.theta = t;
  this.prop.phi = PSVUtils.stayBetween(p, -Math.PI / 2.0, Math.PI / 2.0);

  if (this.renderer) {
    this.render();
  }

  this.trigger('position-updated', this.prop.theta, this.prop.phi);
};

/**
 * The user wants to zoom
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseWheel = function(evt) {
  evt.preventDefault();
  evt.stopPropagation();

  var delta = (evt.detail) ? -evt.detail : evt.wheelDelta;

  if (delta !== 0) {
    var direction = parseInt(delta / Math.abs(delta));
    this.zoom(this.prop.zoom_lvl + direction);
  }
};

/**
 * Zoom
 * @paramlevel (integer) New zoom level
 * @return (void)
 */
PhotoSphereViewer.prototype.zoom = function(level) {
  this.prop.zoom_lvl = PSVUtils.stayBetween(parseInt(Math.round(level)), 0, 100);

  this.camera.fov = this.config.max_fov + (this.prop.zoom_lvl / 100) * (this.config.min_fov - this.config.max_fov);
  this.camera.updateProjectionMatrix();
  this.render();

  this.trigger('zoom-updated', this.prop.zoom_lvl);
};

/**
 * Zoom in
 * @return (void)
 */
PhotoSphereViewer.prototype.zoomIn = function() {
  if (this.prop.zoom_lvl < 100) {
    this.zoom(this.prop.zoom_lvl + 1);
  }
};

/**
 * Zoom out
 * @return (void)
 */
PhotoSphereViewer.prototype.zoomOut = function() {
  if (this.prop.zoom_lvl > 0) {
    this.zoom(this.prop.zoom_lvl - 1);
  }
};

/**
 * Fullscreen state has changed
 * @return (void)
 */
PhotoSphereViewer.prototype._fullscreenToggled = function() {
  this.trigger('fullscreen-updated', PSVUtils.isFullscreenEnabled());
};

/**
 * Enables/disables fullscreen
 * @return (void)
 */
PhotoSphereViewer.prototype.toggleFullscreen = function() {
  if (!PSVUtils.isFullscreenEnabled()) {
    PSVUtils.requestFullscreen(this.container);
  }
  else {
    PSVUtils.exitFullscreen();
  }
};

/**
 * Sets the animation speed
 * @param speed (string) The speed, in radians/degrees/revolutions per second/minute
 * @return (void)
 */
PhotoSphereViewer.prototype.setAnimSpeed = function(speed) {
  speed = speed.toString().trim();

  // Speed extraction
  var speed_value = parseFloat(speed.replace(/^(-?[0-9]+(?:\.[0-9]*)?).*$/, '$1'));
  var speed_unit = speed.replace(/^-?[0-9]+(?:\.[0-9]*)?(.*)$/, '$1').trim();

  // "per minute" -> "per second"
  if (speed_unit.match(/(pm|per minute)$/)) {
    speed_value /= 60;
  }

  var rad_per_second = 0;

  // Which unit?
  switch (speed_unit) {
    // Revolutions per minute / second
    case 'rpm':
    case 'rev per minute':
    case 'revolutions per minute':
    case 'rps':
    case 'rev per second':
    case 'revolutions per second':
      // speed * 2pi
      rad_per_second = speed_value * 2 * Math.PI;
      break;

    // Degrees per minute / second
    case 'dpm':
    case 'deg per minute':
    case 'degrees per minute':
    case 'dps':
    case 'deg per second':
    case 'degrees per second':
      // Degrees to radians (rad = deg * pi / 180)
      rad_per_second = speed_value * Math.PI / 180;
      break;

    // Radians per minute / second
    case 'rad per minute':
    case 'radians per minute':
    case 'rad per second':
    case 'radians per second':
      rad_per_second = speed_value;
      break;

    // Unknown unit
    default:
      m_anim = false;
  }

  // Theta offset
  this.prop.theta_offset = rad_per_second / this.prop.fps;
};

/**
 * Sets the viewer size
 * @param size (Object) An object containing the wanted width and height
 * @return (void)
 */
PhotoSphereViewer.prototype._setViewerSize = function(size) {
  for (var dim in size) {
    if (dim == 'width' || dim == 'height') {
      if (/^[0-9.]+$/.test(size[dim])) {
        size[dim]+= 'px';
      }

      this.container.style[dim] = size[dim];
    }
  }
};

/**
 * Adds an action
 * @param name (string) Action name
 * @param f (Function) The handler function
 * @return (void)
 */
PhotoSphereViewer.prototype.on = function(name, f) {
  if (!(name in this.actions)) {
    this.actions[name] = [];
  }

  this.actions[name].push(f);
};

/**
 * Triggers an action
 * @param name (string) Action name
 * @param arg (mixed) An argument to send to the handler functions
 * @return (void)
 */
PhotoSphereViewer.prototype.trigger = function(name, arg) {
  if ((name in this.actions) && this.actions[name].length > 0) {
    for (var i = 0, l = this.actions[name].length; i < l; ++i) {
      this.actions[name][i](arg);
    }
  }
};
/**
 * Navigation bar class
 * @param psv (PhotoSphereViewer) A PhotoSphereViewer object
 */
var PSVNavBar = function(psv) {
  this.psv = psv;
  this.container = null;
  this.autorotateBtn = null;
  this.zoomBar = null;
  this.fullscreenBtn = null;
  this.caption = null;

  this.create();
};

/**
 * Creates the elements
 * @return (void)
 */
PSVNavBar.prototype.create = function() {
  // Container
  this.container = document.createElement('div');
  this.container.className = 'psv-navbar';

  // Autorotate button
  this.autorotateBtn = new PSVNavBarAutorotateButton(this.psv);
  this.container.appendChild(this.autorotateBtn.getButton());

  // Zoom buttons
  this.zoomBar = new PSVNavBarZoomButton(this.psv);
  this.container.appendChild(this.zoomBar.getButton());

  // Fullscreen button
  this.fullscreenBtn = new PSVNavBarFullscreenButton(this.psv);
  this.container.appendChild(this.fullscreenBtn.getButton());

  // Caption
  this.caption = document.createElement('div');
  this.caption.className = 'psv-caption';
  this.container.appendChild(this.caption);
  this.setCaption(this.psv.config.caption);
};

/**
 * Returns the bar itself
 * @return (HTMLElement) The bar
 */
PSVNavBar.prototype.getBar = function() {
  return this.container;
};

/**
 * Sets the bar caption
 * @param (string) html
 */
PSVNavBar.prototype.setCaption = function(html) {
  if (!html) {
    this.caption.style.display = 'none';
  }
  else {
    this.caption.style.display = 'block';
    this.caption.innerHTML = html;
  }
};
/**
 * Navigation bar button class
 * @param psv (PhotoSphereViewer) A PhotoSphereViewer object
 */
var PSVNavBarButton = function(psv) {
  this.psv = psv;
  this.button = null;
};

/**
 * Creates the button
 * @return (void)
 */
PSVNavBarButton.prototype.create = function() {
  throw "Not implemented";
};

/**
 * Returns the button element
 * @return (HTMLElement) The button
 */
PSVNavBarButton.prototype.getButton = function() {
  return this.button;
};

/**
 * Changes the active state of the button
 * @param active (boolean) true if the button should be active, false otherwise
 * @return (void)
 */
PSVNavBarButton.prototype.toggleActive = function(active) {
  if (active) {
    PSVUtils.addClass(this.button, 'active');
  }
  else {
    PSVUtils.removeClass(this.button, 'active');
  }
};
/**
 * Navigation bar autorotate button class
 * @param psv (PhotoSphereViewer) A PhotoSphereViewer object
 */
var PSVNavBarAutorotateButton = function(psv) {
  PSVNavBarButton.call(this, psv);
  this.create();
};

PSVNavBarAutorotateButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarAutorotateButton.prototype.constructor = PSVNavBarAutorotateButton;

/**
 * Creates the button
 * @return (void)
 */
PSVNavBarAutorotateButton.prototype.create = function() {
  this.button = document.createElement('div');
  this.button.className = 'psv-button psv-autorotate-button';

  var autorotate_sphere = document.createElement('div');
  autorotate_sphere.className = 'psv-autorotate-sphere';
  this.button.appendChild(autorotate_sphere);

  var autorotate_equator = document.createElement('div');
  autorotate_equator.className = 'psv-autorotate-equator';
  this.button.appendChild(autorotate_equator);

  PSVUtils.addEvent(this.button, 'click', this.psv.toggleAutorotate.bind(this.psv));
  this.psv.on('autorotate', this.toggleActive.bind(this));
};
/**
 * Navigation bar fullscreen button class
 * @param psv (PhotoSphereViewer) A PhotoSphereViewer object
 */
var PSVNavBarFullscreenButton = function(psv) {
  PSVNavBarButton.call(this, psv);
  this.create();
};

PSVNavBarFullscreenButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarFullscreenButton.prototype.constructor = PSVNavBarFullscreenButton;

/**
 * Creates the button
 * @return (void)
 */
PSVNavBarFullscreenButton.prototype.create = function() {
  this.button = document.createElement('div');
  this.button.className = 'psv-button psv-fullscreen-button';

  this.button.appendChild(document.createElement('div'));
  this.button.appendChild(document.createElement('div'));

  PSVUtils.addEvent(this.button, 'click', this.psv.toggleFullscreen.bind(this.psv));
  this.psv.on('fullscreen-updated', this.toggleActive.bind(this));
};
/**
 * Navigation bar zoom button class
 * @param psv (PhotoSphereViewer) A PhotoSphereViewer object
 */
var PSVNavBarZoomButton = function(psv) {
  PSVNavBarButton.call(this, psv);

  this.zoom_range = null;
  this.zoom_value = null;
  this.mousedown = false;

  this.create();
};

PSVNavBarZoomButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarZoomButton.prototype.constructor = PSVNavBarZoomButton;

/**
 * Creates the button
 * @return (void)
 */
PSVNavBarZoomButton.prototype.create = function() {
  this.button = document.createElement('div');
  this.button.className = 'psv-button psv-zoom-button';

  var zoom_minus = document.createElement('div');
  zoom_minus.className = 'psv-zoom-minus';
  this.button.appendChild(zoom_minus);

  var zoom_range_bg = document.createElement('div');
  zoom_range_bg.className = 'psv-zoom-range';
  this.button.appendChild(zoom_range_bg);

  this.zoom_range = document.createElement('div');
  this.zoom_range.className = 'psv-zoom-range-line';
  zoom_range_bg.appendChild(this.zoom_range);

  this.zoom_value = document.createElement('div');
  this.zoom_value.className = 'psv-zoom-range-handle';
  this.zoom_range.appendChild(this.zoom_value);

  var zoom_plus = document.createElement('div');
  zoom_plus.className = 'psv-zoom-plus';
  this.button.appendChild(zoom_plus);

  PSVUtils.addEvent(this.zoom_range, 'mousedown', this._initZoomChangeWithMouse.bind(this));
  PSVUtils.addEvent(this.zoom_range, 'touchstart', this._initZoomChangeByTouch.bind(this));
  PSVUtils.addEvent(document, 'mousemove', this._changeZoomWithMouse.bind(this));
  PSVUtils.addEvent(document, 'touchmove', this._changeZoomByTouch.bind(this));
  PSVUtils.addEvent(document, 'mouseup', this._stopZoomChange.bind(this));
  PSVUtils.addEvent(document, 'touchend', this._stopZoomChange.bind(this));
  PSVUtils.addEvent(zoom_minus, 'click', this.psv.zoomOut.bind(this.psv));
  PSVUtils.addEvent(zoom_plus, 'click', this.psv.zoomIn.bind(this.psv));
  this.psv.on('zoom-updated', this._moveZoomValue.bind(this));

  var self = this;
  setTimeout(function() {
    self._moveZoomValue(self.psv.prop.zoom_lvl);
  }, 0);
};

/**
 * Moves the zoom cursor
 * @param level (integer) Zoom level (between 0 and 100)
 * @return (void)
 */
PSVNavBarZoomButton.prototype._moveZoomValue = function(level) {
  this.zoom_value.style.left = (level / 100 * this.zoom_range.offsetWidth - this.zoom_value.offsetWidth / 2) + 'px';
};

/**
 * The user wants to zoom
 * @param evt (Event) The event
 * @return (void)
 */
PSVNavBarZoomButton.prototype._initZoomChangeWithMouse = function(evt) {
  this._initZoomChange(parseInt(evt.clientX));
};

/**
 * The user wants to zoom (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PSVNavBarZoomButton.prototype._initZoomChangeByTouch = function(evt) {
  var touch = evt.changedTouches[0];
  if (touch.target == this.zoom_range || touch.target == this.zoom_value) {
    this._initZoomChange(parseInt(touch.clientX));
  }
};

/**
 * Initializes a zoom change
 * @param x (integer) Horizontal coordinate
 * @return (void)
 */
PSVNavBarZoomButton.prototype._initZoomChange = function(x) {
  this.mousedown = true;
  this._changeZoom(x);
};

/**
 * The user wants to stop zooming
 * @param evt (Event) The event
 * @return (void)
 */
PSVNavBarZoomButton.prototype._stopZoomChange = function(evt) {
  this.mousedown = false;
};

/**
 * The user moves the zoom cursor
 * @param evt (Event) The event
 * @return (void)
 */
PSVNavBarZoomButton.prototype._changeZoomWithMouse = function(evt) {
  evt.preventDefault();
  this._changeZoom(parseInt(evt.clientX));
};

/**
 * The user moves the zoom cursor (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PSVNavBarZoomButton.prototype._changeZoomByTouch = function(evt) {
  var touch = evt.changedTouches[0];
  if (touch.target == this.zoom_range || touch.target == this.zoom_value) {
    evt.preventDefault();
    this._changeZoom(parseInt(touch.clientX));
  }
};

/**
 * Zoom change
 * @param x (integer) Horizontal coordinate
 * @return (void)
 */
PSVNavBarZoomButton.prototype._changeZoom = function(x) {
  if (this.mousedown) {
    var user_input = x - this.zoom_range.getBoundingClientRect().left;
    var zoom_level = user_input / this.zoom_range.offsetWidth * 100;
    this.psv.zoom(zoom_level);
  }
};
/**
 * Static utilities for PSV
 */
var PSVUtils = {};

/**
 * Adds a CSS class to an element
 * @param elt (HTMLElement)
 * @param clazz (string)
 */
PSVUtils.addClass = function(elt, clazz) {
  if (elt.className.length) {
    elt.className+= ' ' + clazz;
  }
  else {
    elt.className = clazz
  }
};

/**
 * Removes a CSS class from an element
 * @param elt (HTMLElement)
 * @param clazz (string)
 */
PSVUtils.removeClass = function(elt, clazz) {
  if (elt.className.length) {
    elt.className = elt.className.replace(new RegExp('\\b' + clazz + '\\b'), '').trim();
  }
};

/**
 * Detects whether canvas is supported
 * @return (boolean) true if canvas is supported, false otherwise
 */
PSVUtils.isCanvasSupported = function() {
  var canvas = document.createElement('canvas');
  return !!(canvas.getContext && canvas.getContext('2d'));
};

/**
 * Detects whether WebGL is supported
 * @return (boolean) true if WebGL is supported, false otherwise
 */
PSVUtils.isWebGLSupported = function() {
  var canvas = document.createElement('canvas');
  return !!(window.WebGLRenderingContext && canvas.getContext('webgl'));
};

/**
 * Get max texture width in WebGL context
 * @return (int)
 */
PSVUtils.getMaxTextureWidth = function() {
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('webgl');
  return ctx.getParameter(ctx.MAX_TEXTURE_SIZE);
};

/**
 * Attaches an event handler function to an elemnt
 * @param elt (HTMLElement) The element
 * @param evt (string) The event name
 * @param f (Function) The handler function
 * @return (void)
 */
PSVUtils.addEvent = function(elt, evt, f) {
  if (!!elt.addEventListener) {
    elt.addEventListener(evt, f, false);
  }
  else {
    elt.attachEvent('on' + evt, f);
  }
};

/**
 * Ensures that a number is in a given interval
 * @param x (number) The number to check
 * @param min (number) First endpoint
 * @param max (number) Second endpoint
 * @return (number) The checked number
 */
PSVUtils.stayBetween = function(x, min, max) {
  return Math.max(min, Math.min(max, x));
};

/**
 * Returns the value of a given attribute in the panorama metadata
 * @param data (string) The panorama metadata
 * @param attr (string) The wanted attribute
 * @return (string) The value of the attribute
 */
PSVUtils.getAttribute = function(data, attr) {
  var a = data.indexOf('GPano:' + attr) + attr.length + 8, b = data.indexOf('"', a);
  return data.substring(a, b);
};

/**
 * Detects whether fullscreen is enabled or not
 * @return (boolean) true if fullscreen is enabled, false otherwise
 */
PSVUtils.isFullscreenEnabled = function() {
  return (document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
};

/**
 * Enters fullscreen mode
 * @param elt (HTMLElement)
 */
PSVUtils.requestFullscreen = function(elt) {
  (elt.requestFullscreen || elt.mozRequestFullScreen || elt.webkitRequestFullscreen || elt.msRequestFullscreen).call(elt);
};

/**
 * Exits fullscreen mode
 * @param elt (HTMLElement)
 */
PSVUtils.exitFullscreen = function(elt) {
  (document.exitFullscreen || document.mozCancelFullScreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
};

/**
 * Merge the enumerable attributes of two objects.
 * @copyright Nicholas Fisher <nfisher110@gmail.com>"
 * @license MIT
 * @param object
 * @param object
 * @return object
 */
PSVUtils.deepmerge = function(target, src) {
  var array = Array.isArray(src);
  var dst = array && [] || {};

  if (array) {
    target = target || [];
    dst = dst.concat(target);
    src.forEach(function(e, i) {
      if (typeof dst[i] === 'undefined') {
        dst[i] = e;
      } else if (typeof e === 'object') {
        dst[i] = PSVUtils.deepmerge(target[i], e);
      } else {
        if (target.indexOf(e) === -1) {
          dst.push(e);
        }
      }
    });
  } else {
    if (target && typeof target === 'object') {
      Object.keys(target).forEach(function (key) {
        dst[key] = target[key];
      });
    }
    Object.keys(src).forEach(function (key) {
      if (typeof src[key] !== 'object' || !src[key]) {
        dst[key] = src[key];
      }
      else {
        if (!target[key]) {
          dst[key] = src[key];
        } else {
          dst[key] = PSVUtils.deepmerge(target[key], src[key]);
        }
      }
    });
  }

  return dst;
};
return PhotoSphereViewer;
}));