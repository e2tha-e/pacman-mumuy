'use strict';

// Date.now polyfill
if(!Date.now){
    Date.now = function() { return new Date().getTime(); };
}

// window.requestAnimationFrame polyfill
(function() {
    var vendors = ['webkit', 'moz'];
    for(var i=0;i<vendors.length&&!window.requestAnimationFrame;i++){
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
            orientation:0, // 0 for up, 1 for right, 2 for down, 3 for left, -1 for stay put
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
    Map.prototype.getXOffset = function(x){
        return Math.abs(x-this.x)%this.size-this.size/2;
    };
    Map.prototype.getYOffset = function(y){
        return Math.abs(y-this.y)%this.size-this.size/2;
    };
    // Canvas coordinates to map coordinates
    Map.prototype.position2coord = function(x,y){
        var xOffset = this.getXOffset(x);
        var yOffset = this.getYOffset(y);
        return {
            x:Math.floor((x-this.x)/this.size),
            y:Math.floor((y-this.y)/this.size),
            offset:xOffset?Math.abs(xOffset):Math.abs(yOffset)
        };
    };
    // Pathfinding algorithm for autonomous NPCs
    Map.prototype.finder = function(params,item,items,player){
        var defaults = {
            map:null,
            start:{},
            end:{},
            type:'pursue',
            avoidOrientation:null,
            preferredOrientation:null
        };
        var options = Object.assign({},defaults,params);
        // When the start or end point is set on the wall
        // Shouldn't ever happen, so console an error and allow to fail
        if(options.map[options.start.y][options.start.x]!=0&&options.map[options.start.y][options.start.x]!=2){
            console.error('NPC ON ILLEGAL START POINT!')
            //debugger;
            return {};
        }else if(options.map[options.end.y][options.end.x]!=0&&options.map[options.end.y][options.end.x]!=2){
            console.error('NPC ON ILLEGAL END POINT!')
            //debugger;
            return {};
        }
        var path = {};
        var y_length  = options.map.length;
        var x_length = options.map[0].length;
        // Gets the value on the map
        var _getValue = function(x,y){
            if(options.map[y]&&typeof options.map[y][x]!='undefined'){
                for(var i=0,l=items.length;i<l;i++){
                    // Uneaten NPC treats other uneaten NPCs as a wall
                    if(
                        item._id!=items[i]._id&&
                        item.status!=4&&
                        items[i].status!=4&&
                        items[i].coord.x==x&&
                        items[i].coord.y==y
                    ){
                        return 3;
                    }
                    // Eaten NPC treats other eaten NPCs as a wall
                    if(
                        item._id!=items[i]._id&&
                        item.status==4&&
                        items[i].status==4&&
                        items[i].coord.x==x&&
                        items[i].coord.y==y
                    ){
                        return 3;
                    }
                }
                return options.map[y][x];
            }
            return -1;
        };
        // Pursue or evade the player, or return home to rejuvenate
        var _render = function(start){
            var vectors = [];
            var next = function(orientation,from,to,_id){
                var x_distance;
                var y_distance;
                var fromValue = _getValue(from.x,from.y);
                var toValue = _getValue(to.x,to.y);
                // If fromValue is the same as another NPC, give a 50% chance of not moving in this orientation so the other NPC can move away
                if(fromValue==3&&Math.random()<0.5){
                    return {};
                }
                // If not the wall and not on another NPC
                if(toValue!=1&&toValue!=3){
                    // If inside the den
                    if(fromValue==2){
                        item.inDen = true;
                        if(options.type=='pursue'){
                            // Go to den entrance.
                            x_distance=item.denEntrance.x-to.x;
                            y_distance=item.denEntrance.y-to.y;
                        }else if(options.type=='evade'||options.type=='rejuvenateStart'){
                            x_distance=item.denHome.x-to.x;
                            y_distance=item.denHome.y-to.y;
                        }
                        return {orientation:orientation,x:to.x,y:to.y,x_distance:x_distance,y_distance:y_distance};
                    }else{
                        item.inDen = false;
                        if(options.type=='pursue'||options.type=='rejuvenateEnd'){
                            if(toValue<1){
                                x_distance=options.end.x-to.x;
                                y_distance=options.end.y-to.y;
                            }
                        }else if(options.type=='evade'||options.type=='rejuvenateStart'){
                            if(from.x==item.denEntrance.x&&from.y==item.denEntrance.y){
                                if(toValue==2){
                                    // If at den entrance, enter den and go to den home
                                    x_distance=item.denHome.x-to.x;
                                    y_distance=item.denHome.y-to.y;
                                }else{
                                    return {};
                                }
                            }else if(toValue<1){
                                x_distance=options.end.x-to.x;
                                y_distance=options.end.y-to.y;
                            }
                        }
                        // Emerge from other side of tunnel
                        if(toValue==-1){
                            to.x = (to.x+x_length)%x_length;
                        }
                        // Check 1 coord further in same orientation for an NPC. Return empty object if so
                        var furtherValue;
                        switch(orientation){
                            case 0:
                                furtherValue = _getValue(to.x,to.y-1);
                                break;
                            case 1:
                                furtherValue = _getValue(to.x+1,to.y);
                                break;
                            case 2:
                                furtherValue = _getValue(to.x,to.y+1);
                                break;
                            case 3:
                                furtherValue = _getValue(to.x-1,to.y);
                                break;
                        }
                        if(furtherValue==3){
                            item.adjacentNpcOrientations.push(orientation);
                        }
                        return {orientation:orientation,x:to.x,y:to.y,x_distance:x_distance,y_distance:y_distance,toValue:toValue};
                    }
                }
                return {};
            }; // End next() subroutine
            // Begin _render() main execution
            // For this condition, item.inDen should be set by index.js and must be before the next() operations
            if(item.inDen&&(item.status==3||item.status==4)&&options.start.x==item.denHome.x&&options.start.y==item.denHome.y){
                return [{orientation:-1}];
            }
            item.adjacentNpcOrientations = [];
            vectors[0] = options.avoidOrientation==0?{}:next(0,start,{x:start.x,y:start.y-1},item._id);
            vectors[1] = options.avoidOrientation==1?{}:next(1,start,{x:start.x+1,y:start.y},item._id);
            vectors[2] = options.avoidOrientation==2?{}:next(2,start,{x:start.x,y:start.y+1},item._id);
            vectors[3] = options.avoidOrientation==3?{}:next(3,start,{x:start.x-1,y:start.y},item._id);
            var orientations = vectors.reduce(function(acc, cur){
                return acc + (typeof cur.orientation=='undefined'?'':cur.orientation);
            }, '');
            if(orientations==''){
                return [{orientation:-1}];
            }
            return vectors;
        };
        var distanceToBeat = Number.MAX_VALUE;
        var _getBestVector = function(vector){
            if(typeof vector.x_distance=='number'&&typeof vector.y_distance=='number'){
                if(typeof this.x_distance=='number'&&typeof this.y_distance=='number'){
                    if(distanceToBeat==Number.MAX_VALUE){
                        distanceToBeat = Math.abs(this.x_distance)+Math.abs(this.y_distance);
                    }
                }
                var contestingDistance = Math.abs(vector.x_distance)+Math.abs(vector.y_distance);
                // Weigh against simply reversing direction
                if(vector.orientation==(item.orientation+2)%4){
                    if(distanceToBeat==Number.MAX_VALUE){
                        distanceToBeat = contestingDistance+1+item.numReversals;
                        Object.assign(this,vector);
                        return;
                    }else{
                        contestingDistance += 1+item.numReversals;
                    }
                }
                // If NPC is sick and not in den, factor in distance from player
                if(item.status==3){
                    if(!item.inDen&&player){
                        // Give greater weight to distanceFromPlayer by multiplying by 2
                        var distanceFromPlayer=2*(Math.abs(player.coord.x-vector.x)+Math.abs(player.coord.y-vector.y));
                        contestingDistance -= distanceFromPlayer;
                    }
                }else if(item.status==1){
                    if(!item.inDen){
                        // In order to break out of corners where NPCs oscillate back and forth so long as the player doesn't move,
                        // add a chance of choosing this vector without consideration of distance to player.
                        // Differs per NPC as per https://en.wikipedia.org/wiki/Pac-Man#Gameplay
                        var threshold = 0.1*(item._id-3);
                        if(Math.random()<threshold){
                            Object.assign(this,vector);
                            return;
                        }
                    }
                }
                if(contestingDistance<distanceToBeat){
                    distanceToBeat = contestingDistance;
                    Object.assign(this,vector);
                }
            }
        }
        var _shuffle = function(a){
            var i,j,x;
            for(i=a.length-1;i>0;i--){
                j = Math.floor(Math.random()*(i+1));
                x = a[i];
                a[i] = a[j];
                a[j] = x;
            }
            return a;
        }

        // Main execution of Map.prototype.finder()
        var vectors = _render(options.start);
        if(item.inDen){
            var homeIdx;
            vectors.forEach(function(vector,idx){
                if(vector.orientation==-1){
                    homeIdx = idx;
                }
            });
            if(typeof homeIdx=='number'){
                path = vectors[homeIdx];
            }else{
                vectors.forEach(_getBestVector,path);
            }
        }else{
            item.atIntersection = false;
            vectors.forEach(function(vector){
                if(
                    typeof vector.orientation=='number'&&
                    vector.orientation!=item.orientation&&
                    vector.orientation!=(item.orientation+2)%4
                ){
                    item.atIntersection = true;
                }
            });
            if(item.adjacentNpcOrientations.includes(item.orientation)){
                return {orientation:-1};
            }
            // Continue in a straight line if there is no intersection unless status just changed
            if(
                options.type!='rejuvenateStart'&&
                options.type!='rejuvenateEnd'&&
                !item.atIntersection&&
                !( // Does not apply immediately after NPC gets sick
                    item.status==3&&
                    item.timeout>400
                )&&
                !( // Does not apply when evading and at den entrance
                    options.type=='evade'&&
                    options.start.x==item.denEntrance.x&&
                    options.start.y==item.denEntrance.y
                )
            ){
                for(var i=0,l=vectors.length;i<l;i++){
                    if(vectors[i]&&vectors[i].toValue==-1){
                        return vectors[i];
                    }
                }
                return {};
            }
            _shuffle(vectors);
            vectors.forEach(_getBestVector,path);
            if(path.orientation==(item.orientation+2)%4){
                item.numReversals++;
            }else{
                item.numReversals = 0;
            }
        }
        return path;
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
        this.f = null;
        this.fTime = null;
    };
    Stage.prototype.createAudioHandler = function(options){
        var audio = new AudioHandler(options);
        this.audio[audio.name] = audio;
        return audio;
    };
    Stage.prototype.createItem = function(options){
        var item = new Item(options);
        if(item.location){
            // Need to account for Pac-Man starting at a decimal (centered) x coordinate
            // The other items are unaffected
            item.coord.x=Math.floor(item.coord.x);
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
        var stage0Cleared = false;
        var skipFrame = function(){
            _handler = requestAnimationFrame(fn);
        };
        var fn = function(){
            var stage = _stages[_index];
            var mapCurr = stage.maps[stage.index];
            var mapNext = stage.maps[stage.index+1];
            stage.f = stage.f||0;
            var stageUpdate = stage.update();
            //if(stage.update()==true){
            if(stageUpdate==true){
                stage.f++;
                if(stage.timeout){
                    stage.timeout--;
                }
                if(stage.status==1&&mapNext){
                    if(!(stage.f%mapNext.frames)){
                        mapNext.times = stage.f/mapNext.frames;
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
                    if(!(stage.f%item.frames)){
                        item.times = stage.f/item.frames;
                    }
                    // Neither the stage nor the item is paused
                    if(stage.status==1&&item.status!=2){
                        if(item.timeout){
                            item.timeout--;
                        }
                        item.update();
                    }
                    item.draw(_pacdContext, _charContext);
                });
            }
            // Try to have this run at ~45fps. 60fps is too fast
            var elapsed = stage.fTime?Date.now()-stage.fTime:Date.now();
            if(elapsed<18&&stage.f%4==0){
                _handler = requestAnimationFrame(skipFrame);
            }else{
                _handler = requestAnimationFrame(fn);
            }
            if(stageUpdate==true){
                stage.fTime = Date.now();
            }
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
            throw new Error('Cannot find new stage.');
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
