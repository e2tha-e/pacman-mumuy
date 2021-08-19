'use strict';

// Date.now polyfill
if(!Date.now){
    Date.now = function() { return new Date().getTime(); };
}

// window.requestAnimationFrame polyfill
(function() {
    var vendors = ['webkit', 'moz'];
    for(var i = 0; i < vendors.length&&!window.requestAnimationFrame; i++){
        var vp = vendors[i];
        window.requestAnimationFrame = window[vp+'RequestAnimationFrame'];
        window.cancelAnimationFrame = (window[vp+'CancelAnimationFrame']||window[vp+'CancelRequestAnimationFrame']);
    }
    if(
        /iP(ad|hone|od).*OS 6/.test(window.navigator.userAgent)|| // iOS6 is buggy
        !window.requestAnimationFrame||!window.cancelAnimationFrame
    ){
        var lastTime = 0;
        window.requestAnimationFrame = function(callback) {
            var now = Date.now();
            var nextTime = Math.max(lastTime + 16, now);
            return setTimeout(function() { callback(lastTime = nextTime); },
            nextTime - now);
        };
        window.cancelAnimationFrame = clearTimeout;
    }
}());

function Game(mazeEl, pacdEl, charEl, params){
    var _ = this;
    var settings = {
        width:960, // Canvas width
        height:640 // Canvas height
    };
    Object.assign(_,settings,params);
    var mazeCanvas = document.getElementById(mazeEl);
    var pacdCanvas = document.getElementById(pacdEl);
    var charCanvas = document.getElementById(charEl);
    mazeCanvas.width = _.width;
    mazeCanvas.height = _.height;
    pacdCanvas.width = _.width;
    pacdCanvas.height = _.height;
    charCanvas.width = _.width;
    charCanvas.height = _.height;
    var _mazeContext = mazeCanvas.getContext('2d');
    var _pacdContext = pacdCanvas.getContext('2d');
    var _charContext = charCanvas.getContext('2d');
    var _stages = []; // The stage object queue
    var _events = {}; // The collection of events
    var _index=0, // The current stage index
        _handler; // Frame animation control

    // Begin AudioHandler definition
    var AudioHandler = function(params){
        this._params = {};
        this._settings = {
            name:'',
            uri:'',
            element:null,
            playing:[]
        };
        if(typeof params=='string'){
            this._settings.name = params;
            this._settings.uri = 'audio/'+params+'.mp3';
        }else if(params instanceof Object){
            this._params = params;
        }
        Object.assign(this,this._settings,this._params);
    }
    AudioHandler.prototype.load = function(playing){
        var audioHandler = this;
        this.element = new Audio(this.uri);
        this.playing = playing||this.playing;
        this.element.addEventListener('ended', function(){
            var indexOfName = audioHandler.playing.indexOf(audioHandler.name);
            if (indexOfName>-1){
                audioHandler.playing.splice(indexOfName,1);
            }
        });
        return this;
    };
    AudioHandler.prototype.play = function(){
        if(!this.playing.includes(this.name)){
            this.playing.push(this.name);
        }
        this.element.play();
        return this;
    };
    AudioHandler.prototype.pause = function(){
        var indexOfName = this.playing.indexOf(this.name);
        if (indexOfName>-1){
            this.playing.splice(indexOfName,1);
        }
        this.element.pause();
        return this;
    };
    // End AudioHandler definition

    // Begin Item definition
    var Item = function(params){
        this._params = params||{};
        this._id = 0; // The marker
        this._stage = null; // Bind to the stage to which it belongs
        this._settings = {
            x:0,
            y:0,
            width:20,
            height:20,
            type:0, // 0 for normal objects (not tied to the map), 1 for player control objects, 2 for program control objects
            color:'#F00',
            status:1, // 0 for inactive/ended, 1 for normal, 2 for paused, 3 for temporary, 4 for exception
            audioLast:'',
            orientation:0, // 0 for right, 1 for down, 2 for left, 3 for up
            speed:0,
            // Map-related
            location:null, // Map object
            coord:null, // If the object is bound to the map, you need to set the map coordinates; If not bound, set the location coordinates
            path:[], // The path that the NPC autonomously traverses
            vector:null, // The target coordinates
            // Layout-related
            frames:1, // How many frames to render in one item cycle
            times:0, // Number of item cycles processed
            timeout:0, // For determining when to proceed to next animation state
            control:{}, // Controls the cache and processes it when it reaches the anchor point
            update:function(){},
            draw:function(){}
        };
        Object.assign(this,this._settings,this._params);
    };
    // Bind an event type to the item
    Item.prototype.bind = function(eventType,callback){
        if(!_events[eventType]){
            _events[eventType] = {};
            mazeCanvas.addEventListener(eventType,function(e){
                var position = _.getPosition(e);
                _stages[_index].items.forEach(function(item){
                    if(Math.abs(position.x-item.x)<item.width/2&&Math.abs(position.y-item.y)<item.height/2){
                        var key = 's'+_index+'i'+item._id;
                        if(_events[eventType][key]){
                            _events[eventType][key](e);
                        }
                    }
                });
                e.preventDefault();
            });
        }
        _events[eventType]['s'+this._stage.index+'i'+this._id] = callback.bind(this);
    };
    // End Item definition

    // Begin Map definition
    var Map = function(params){
        this._params = params||{};
        this._id = 0;
        this._stage = null; // Bind to the stage to which it belongs
        this._settings = {
            x:0,
            y:0,
            size:20, // The width of the map unit
            data:[],
            x_length:0,
            y_length:0,
            frames:1, // How many frames to render in one map cycle
            times:0, // Number of map cycles processed
            cache:false, // Whether to set the cache static (if static)
            draw:function(){},
        };
        Object.assign(this,this._settings,this._params);
    };
    // Gets the value of a point on the map
    Map.prototype.get = function(x,y){
        if(this.data[y]&&typeof this.data[y][x]!='undefined'){
            return this.data[y][x];
        }
        return -1;
    };
    // Set the value of a point on the map
    Map.prototype.set = function(x,y,value){
        if(this.data[y]){
            this.data[y][x] = value;
        }
    };
    // Map coordinates to canvas coordinates
    Map.prototype.coord2position = function(cx,cy){
        return {
            x:this.x+cx*this.size+this.size/2,
            y:this.y+cy*this.size+this.size/2
        };
    };
    // Canvas coordinates to map coordinates
    Map.prototype.position2coord = function(x,y){
        var fx = Math.abs(x-this.x)%this.size-this.size/2;
        var fy = Math.abs(y-this.y)%this.size-this.size/2;
        return {
            x:Math.floor((x-this.x)/this.size),
            y:Math.floor((y-this.y)/this.size),
            offset:Math.sqrt(fx*fx+fy*fy)
        };
    };
    // Addressing algorithm
    Map.prototype.finder = function(params){
        var defaults = {
            map:null,
            start:{},
            end:{},
            type:'path'
        };
        var options = Object.assign({},defaults,params);
        // When the start or end point is set on the wall
        if(options.map[options.start.y][options.start.x]||options.map[options.end.y][options.end.x]){
            return [];
        }
        var finded = false;
        var result = [];
        var y_length  = options.map.length;
        var x_length = options.map[0].length;
        // The mapping of the steps
        var steps = [];
        for(var y=y_length;y--;){
            steps[y] = new Array(x_length).fill(0);
        }
        // Gets the value on the map
        var _getValue = function(x,y){
            if(options.map[y]&&typeof options.map[y][x]!='undefined'){
                return options.map[y][x];
            }
            return -1;
        };
        // Decide if you can go, then go and put it in the list
        var _next = function(to){
            var value = _getValue(to.x,to.y);
            if(value<1){
                if(value==-1){
                    to.x = (to.x+x_length)%x_length;
                    to.y = (to.y+y_length)%y_length;
                    to.change = 1;
                }
                if(!steps[to.y][to.x]){
                    result.push(to);
                }
            }
        };
        // Look for the line
        var _render = function(list){
            var new_list = [];
            var next = function(from,to){
                var value = _getValue(to.x,to.y);
                // Whether the current point can go
                if(value<1){
                    if(value==-1){
                        to.x = (to.x+x_length)%x_length;
                        to.y = (to.y+y_length)%y_length;
                        to.change = 1;
                    }
                    if(to.x==options.end.x&&to.y==options.end.y){
                        steps[to.y][to.x] = from;
                        finded = true;
                    }else if(!steps[to.y][to.x]){
                        steps[to.y][to.x] = from;
                        new_list.push(to);
                    }
                }
            };
            list.forEach(function(current){
                next(current,{y:current.y+1,x:current.x});
                next(current,{y:current.y,x:current.x+1});
                next(current,{y:current.y-1,x:current.x});
                next(current,{y:current.y,x:current.x-1});
            });
            if(!finded&&new_list.length){
                _render(new_list);
            }
        };
        _render([options.start]);
        if(finded){
            var current=options.end;
            if(options.type=='path'){
                while(current.x!=options.start.x||current.y!=options.start.y){
                    result.unshift(current);
                    current=steps[current.y][current.x];
                }
            }else if(options.type=='next'){
                _next({x:current.x+1,y:current.y});
                _next({x:current.x,y:current.y+1});
                _next({x:current.x-1,y:current.y});
                _next({x:current.x,y:current.y-1});
            }
        }
        return result;
    };
    // End Map definition

    // Begin Stage definition
    var Stage = function(params){
        this._params = params||{};
        this._settings = {
            index:0,
            status:0, // 0 for inactive/ended, 1 for normal, 2 for paused, 3 for temporary state
            maps:[],
            audio:{},
            audioPlaying:[],
            audioLast:'',
            images:[],
            items:[],
            timeout:0, // For determining when to proceed to next animation state
            nextStage:false, // For determining when to clear all beans and run game.nextStage()
            update:function(){ return true; }
        };
        Object.assign(this,this._settings,this._params);
    };
    Stage.prototype.createAudioHandler = function(options){
        var audio = new AudioHandler(options);
        this.audio[audio.name] = audio;
        return audio;
    };
    Stage.prototype.createItem = function(options){
        var item = new Item(options);
        if(item.location){
            Object.assign(item,item.location.coord2position(item.coord.x,item.coord.y));
        }
        item._stage = this;
        item._id = this.items.length;
        this.items.push(item);
        return item;
    };
    // Reset the position of all items
    Stage.prototype.resetItems = function(){
        this.status = 1;
        this.items.forEach(function(item,index){
            Object.assign(item,item._settings,item._params);
            if(item.location){
                Object.assign(item,item.location.coord2position(item.coord.x,item.coord.y));
            }
        });
    };
    // Get a filtered array of items
    Stage.prototype.getItemsByType = function(type){
        return this.items.filter(function(item){
        return item.type == type;
        });
    };
    Stage.prototype.createMap = function(options){
        var map = new Map(options);
        map.data = JSON.parse(JSON.stringify(map._params.data));
        map.y_length = map.data.length;
        map.x_length = map.data[0].length;
        map._stage = this;
        map._id = this.maps.length;
        this.maps.push(map);
        return map;
    };
    Stage.prototype.resetMaps = function(){
        _mazeContext.clearRect(0,0,_.width,_.height);
        _pacdContext.clearRect(0,0,_.width,_.height);
        _charContext.clearRect(0,0,_.width,_.height);
        this.status = 1;
        this.maps.forEach(function(map){
            Object.assign(map,map._settings,map._params);
            map.data = JSON.parse(JSON.stringify(map._params.data));
            map.y_length = map.data.length;
            map.x_length = map.data[0].length;
            map.draw(_mazeContext);
        });
    };
    // Reset items and maps
    Stage.prototype.reset = function(){
        Object.assign(this,this._settings,this._params);
        this.resetItems();
        this.resetMaps();
    };
    // Bind an event type to the stage
    Stage.prototype.bind = function(eventType,callback){
        if(!_events[eventType]){
            _events[eventType] = {};
            window.addEventListener(eventType,function(e){
                var key = 's' + _index;
                if(_events[eventType][key]){
                    _events[eventType][key](e);
                }
                e.preventDefault();
            });
        }
        _events[eventType]['s'+this.index] = callback.bind(this);
    };
    // End Stage definition

    // Continue Game definition
    this.start = function() { // Invoked by this.init
        var f = 0; // Current frame number
        var stage0Cleared = false;
        var fn = function(){
            var stage = _stages[_index];
            var mapCurr = stage.maps[stage.index];
            var mapNext = stage.maps[stage.index+1];
            if(stage.update()==true){
                f++;
                if(stage.timeout){
                    stage.timeout--;
                }
                if(stage.status==1&&mapNext){
                    if(!(f%mapNext.frames)){
                        mapNext.times = f/mapNext.frames;
                    }
                    if(!stage0Cleared){
                        _mazeContext.clearRect(0,0,_.width,_.height);
                        _pacdContext.clearRect(0,0,_.width,_.height);
                        stage0Cleared = true;
                        mapCurr.draw(_mazeContext);
                        if(!mapNext.cache){
                            mapNext.draw(_mazeContext);
                        }
                    }
                }
                if(stage.status!=2){
                    _charContext.clearRect(0,0,_.width,_.height);
                }
                stage.items.forEach(function(item){
                    if(!(f%item.frames)){
                        item.times = f/item.frames;
                    }
                    // Neither the stage nor the item is paused
                    if(stage.status==1&&item.status!=2){
                        if(item.location){
                            item.coord = item.location.position2coord(item.x,item.y);
                        }
                        if(item.timeout){
                            item.timeout--;
                        }
                        item.update();
                    }
                    item.draw(_pacdContext, _charContext);
                });
            }
            _handler = requestAnimationFrame(fn);
        };
        _handler = requestAnimationFrame(fn);
    };
    this.stop = function(){
        _handler&&cancelAnimationFrame(_handler);
    };
    // Canvas position
    this.getPosition = function(e){
        var box = mazeCanvas.getBoundingClientRect();
        return {
            x:e.clientX-box.left*(_.width/box.width),
            y:e.clientY-box.top*(_.height/box.height)
        };
    }
    this.createStage = function(options){
        var stage = new Stage(options);
        stage.index = _stages.length;
        _stages.push(stage);
        return stage;
    };
    this.setStage = function(index){
        _stages[_index].status = 0;
        _index = index;
        _stages[_index].status = 1;
        _stages[_index].reset();
        return _stages[_index];
    };
    this.nextStage = function(){
        if(_index<_stages.length-1){
            return this.setStage(++_index);
        }else{
            throw new Error('unfound new stage.');
        }
    };
    this.getStages = function(){
        return _stages;
    };
    // Reset _index and start
    this.init = function(){
        _index = 0;
        this.start();
    };
}
