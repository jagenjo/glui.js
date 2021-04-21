//handles immediate gui stuff
//requires Canvas2DtoWebGL
var GLUI = {};

GLUI.NONE = 0;
GLUI.HOVER = 1;
GLUI.CLICKED = 2;

//cell position in the ICONS atlas texture
GLUI.icons = {
	x: [4,2],
	cursor: [6,3],
	cursor_empty: [7,3],
	copy: [8,3],
	paste: [9,3],
	trash: [10,0],
	plus: [0,6],
	minus: [1,6],
	left: [0,3],
	right: [1,3],
	up: [2,3],
	down: [3,3],
	left_arrow: [0,2],
	right_arrow: [1,2],
	up_arrow: [2,2],
	down_arrow: [3,2],
	left_thin: [4,3],
	right_thin: [5,3],
	up_thin: [12,3],
	down_thin: [13,3],
	play: [5,1],
	stop: [4,1],
	pause: [6,1],
	record: [0,1],
	note: [13,4],
	circle: [0,1],
	circle_empty: [1,1]	
};

GLUI.cursor = "";

function GLUIContext()
{
	this.ctx = null;
	this.icons = "data/icons.png";
	this.icon_size = 64;

	this.prev_click_pos = null; //click before current click
	this.last_click_pos = null; //current click
	this.last_pos = [0,0];
	this.last_noclick_time = 0; //used for dbl click
	this.last_mouseup_time = 0; //last time the mouse did a mouse up

	this.prev_frame_blocked_areas = [];
	this.blocked_areas = [];
	this.disabled_area = [];

	this.active_widget_reference = null;
	this.prev_active_widget_reference = null;
	this.dragging_widget = null;
	this.input_enabled = true; //to block user interaction
	this.capture_keys = false; //in case key events are being captured
	this.wasShift = false;
	this.cancel_next_mouseup = false; //used to avoid a secondary click when a popup is closed
	this.tab_to_next = 0;
	this.wheel_delta = 0;
	this.value_changed = false;
	this.dragged_item = null; //the element currently being dragged, must be set manually
	this.last_mouse_event = null;

	this.keys_buffer = [];

	this.mouse = {
		position: [0,0], //0,0 top-left corner
		buttons: 0,
		dragging: 0
	};

	this.value_changed = false;

	this.fontFamily = "Arial";
	this.tooltip = null;

	this.style = {
		color: [0.8,0.8,0.8,1],
		backgroundColor: [0.1,0.1,0.1,1],	
		backgroundColor_hover: [0.5,0.5,0.5],
		borderRadius: 10
	};
}

GLUI.Context = GLUIContext;

GLUIContext.prototype.init = function(ctx)
{
	var that = this;
	this.context = ctx;

	if(this.context.webgl_version) //litegl
	{
		GL.blockable_keys["Tab"] = true;
		var params = { minFilter: GL.LINEAR_MIPMAP_LINEAR, anisotropic: 8 };
		if(this.icons)
		{
			var img = gl.textures[this.icons];
			if(!img)
				this._icons_texture = gl.textures[this.icons] = GL.Texture.fromURL( this.icons, params );
		}
	}
	else
	{
		this._icons_texture = new Image();
		this._icons_texture.src = this.icons;
	}

	this.resetGUI();
}

//mouse info must contain the mouse event or an object with similar structure
//{ mousex: int, mousey: int, buttons: int, dragging: bool }
GLUIContext.prototype.setMouse = function(mouse_info)
{
	//copy old
	this.last_pos[0] = this.mouse.position[0];
	this.last_pos[1] = this.mouse.position[1];
	//update new
	this.mouse.position[0] = mouse_info.mousex; 
	this.mouse.position[1] = mouse_info.mousey; //0 is top
	this.mouse.buttons = mouse_info.buttons;
	this.mouse.dragging = mouse_info.dragging;
}

GLUIContext.prototype.resetGUI = function()
{
	var tmp = this.prev_frame_blocked_areas;
	this.prev_frame_blocked_areas = this.blocked_areas;
	this.blocked_areas = tmp;
	this.blocked_areas.length = 0;
	this.disabled_area.length = 0;
	//this.keys_buffer.length = 0;
	this.capture_keys = false;
	this.tooltip = "";
	if(this.context && this.context.start2D) //for webgl
		this.context.start2D();
	this.value_changed = false;
	GLUI.cursor = "";
}

GLUIContext.prototype.finish = function()
{
	if( this.context_menu )
	{
		if( this.drawContextMenu( this.context_menu ) === true )
			this.context_menu = null;
	}
	
	this.wheel_delta = 0; //avoid acumulate
}

//blocks means the GUI is processing already this area so do not send to canvas
GLUIContext.prototype.blockArea = function(x,y,w,h,options)
{
	this.blocked_areas.push([x,y,w,h,options]);
}

//blocks means the GUI is processing already this area so do not send to canvas
GLUIContext.prototype.disableArea = function(x,y,w,h)
{
	var area = [x,y,w,h];
	this.disabled_area.push(area);
	return area;
}

//to reenable area
GLUIContext.prototype.enableArea = function(area)
{
	var index = this.disabled_area.indexOf(area);
	if(index != -1)
		this.disabled_area.splice(index,1);
}

//tells you if there is an area capturing the mouse
GLUIContext.prototype.isPositionBlocked = function(x,y,current)
{
	var areas = current ? this.blocked_areas : this.prev_frame_blocked_areas;
	var pos = x.length ? x : [x,y];
	for(var i = 0; i < this.prev_frame_blocked_areas.length; ++i)
	{
		var b = this.prev_frame_blocked_areas[i];
		if( this.isInsideRect( pos, b[0],b[1],b[2],b[3] ) )
			return true;
	}
	return false;
}

GLUIContext.prototype.isInsideRect = function (pos, x,y,w,h)
{
	if(!this.input_enabled) //in case input is disabled
		return false;

	if(x.length)
	{
		y = x[1];
		w = x[2];
		h = x[3];
		x = x[0];
	}
	var inside = pos[0] > x && pos[0] < (x + w) && pos[1] > y && pos[1] < (y + h);

	//check if this area is not valid for the mouse
	if(this.disabled_area.length)
	{
		for(var i = 0; i < this.disabled_area.length; ++i)
		{
			var b = this.disabled_area[i];
			if( pos[0] > b[0] && pos[0] < (b[0] + b[2]) && pos[1] > b[1] && pos[1] < (b[1] + b[3]) )
				return false;
		}
	}

	return inside;
}

GLUIContext.prototype.onFileDrop = function(e)
{
	var areas = this.blocked_areas;
	var x = e.canvasx;
	var y = e.canvasy;
	var pos = [x,y];
	for(var i = 0; i < this.prev_frame_blocked_areas.length; ++i)
	{
		var b = this.prev_frame_blocked_areas[i];
		if( b[4] && b[4].onFile && this.isInsideRect( pos, b[0],b[1],b[2],b[3] ) )
		{
			b[4].onFile(e);
			return true;
		}
	}
	return false;
}

//called when the mouse event is produced
GLUIContext.prototype.onMouse = function(e)
{
	GLUI.cursor = "";
	this.last_mouse_event = e;

	if(e.type == "mousedown" && e.button == 0)
	{
		this.last_noclick_time = getTime() - this.last_mouseup_time;
		this.last_click_time = 0;
		this.cancel_next_mouseup = false; //new click
		this.wasShift = e.shiftKey;
		this.prev_click_pos = this.mouse.position.concat();
		this.last_click_pos = this.mouse.position.concat();
		var b = this.active_widget_reference ? this.active_widget_reference.area : null;
		if(b && !this.isInsideRect( this.mouse.position, b))
		{
			this.prev_active_widget_reference = this.active_widget_reference;
			this.active_widget_reference = null;
		}
	}
	else if(e.type == "mouseup" && e.button == 0)
	{
		this.dragged_item = null;
		this.mouse.dragging = false;
		this.last_mouseup_pos = this.last_click_pos;
		this.last_click_pos = null;
		this.last_click_time = e.click_time;
		this.last_mouseup_time = getTime();
		if( this.cancel_next_mouseup )
		{
			this.cancel_next_mouseup = false;
			return true;
		}
	}
	else if(e.type == "mousewheel" || e.type == "wheel")
	{
		this.wheel_delta += (e.wheel > 0) ? 1 : -1;
	}
}

GLUIContext.prototype.wasMouseClicked = function()
{
	return this.prev_click_pos != null;
}

//blocks this mouse click from being reused
GLUIContext.prototype.consumeClick = function()
{
	this.last_click_pos = null;
	this.prev_click_pos = null;
	this.cancel_next_mouseup = true; //used to avoid a secondary click when a popup is closed
}

GLUIContext.prototype.setDraggedItem = function(item, extra)
{
	if(!item)
		this.dragged_item = null;
	else
		this.dragged_item = {
			item: item,
			x: this.last_pos[0],
			y: this.last_pos[1],
			extra: extra
		};
}

GLUIContext.prototype.onKey = function(e)
{
	if( this.capture_keys )
		this.keys_buffer.push(e);
	return this.capture_keys;
}

GLUIContext.prototype.onPaste = function(e, text)
{
	if( this.capture_keys )
		this.keys_buffer.push(text);
	else
		return false;
	return true;
}

GLUIContext.prototype.Label = function(x,y,w,h,text,color,fontsize)
{
	var ctx = this.context;
	ctx.font = (fontsize || Math.floor(h*0.8)) + "px " + this.fontFamily;
	ctx.textAlign = "left";
	ctx.fillColor = color || [0.9,0.9,0.9,ctx.globalAlpha];
	ctx.fillText(String(text),x,y + h * 0.7);
}

GLUIContext.prototype.Bullet = function( x,y,s, enabled, color, color_hover )
{
	this.blocked_areas.push([x,y,s,s]);

	var hover = this.isInsideRect( this.mouse.position, x,y,s,s );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var ctx = this.context;
	if(hover)
		GLUI.cursor = "arrow";

	ctx.fillColor = [1,1,1,0.2];
	ctx.beginPath();
	ctx.arc(x+s*0.5,y+s*0.5,s*0.4,0,Math.PI*2);
	ctx.fill();

	ctx.fillColor = color || [0.02,0.02,0.02,ctx.globalAlpha];
	if(hover)
		ctx.fillColor = color_hover || [0.5,0.5,0.5,ctx.globalAlpha];
	else if(enabled)
		ctx.fillColor = color_hover || [0.9,0.9,0.9,ctx.globalAlpha];

	ctx.beginPath();
	ctx.arc(x+s*0.5,y+s*0.5,s*0.3,0,Math.PI*2);
	ctx.fill();


	if( this.prev_click_pos && this.isInsideRect( this.prev_click_pos, x,y,s,s ) )
	{
		this.prev_click_pos = null; //cancel it
		return true;
	}
	return false;
}

//tells you if the mouse clicked or hovered an area
GLUIContext.prototype.HoverArea = function(x,y,w,h)
{
	this.blocked_areas.push([x,y,w,h]);
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;
	if( this.prev_click_pos && this.isInsideRect( this.prev_click_pos, x,y,w,h ) )
	{
		this.prev_click_pos = null; //cancel it
		this.cancel_next_mouseup = true;
		return GLUI.CLICKED;
	}
	return hover ? GLUI.HOVER : GLUI.NONE;
}

//returns if the button was pressed
GLUIContext.prototype.Button = function(x,y,w,h,content,enabled,color,color_hover,border)
{
	this.blocked_areas.push([x,y,w,h]);

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var ctx = this.context;
	if(hover)
		GLUI.cursor = "pointer";

	if (color !== 0) //color 0 means no bg
	{
		ctx.fillColor = color || this.style.backgroundColor;
		if(hover)
			ctx.fillColor = color_hover || this.style.backgroundColor_hover;
		else if(enabled)
			ctx.fillColor = color_hover || [0.9,0.9,0.9,ctx.globalAlpha];

		if( ctx.fillColor[3] > 0)
		{
			if(border == -2 && content && content.constructor === Array ) //bg icon
			{
				if(this._icons_texture)
				{
					ctx.tintImages = true;
					ctx.drawImage( this._icons_texture, 0, 0, this.icon_size,this.icon_size, x, y, w, h );
					ctx.tintImages = false;
				}
			}
			else
			{
				ctx.beginPath();
				if(border == -1)
					ctx.arc(x+w*0.5,y+h*0.5,h*0.5,0,Math.PI*2);
				else if(border == 0)
					ctx.rect(x,y,w,h);
				else
					ctx.roundRect(x,y,w,h,border || this.style.borderRadius);
				ctx.fill();
			}
		}
	}

	if(content != null)
	{
		if(content.constructor === String)
		{
			ctx.textAlign = "center";
			ctx.font = ((h * 0.75)|0) + "px Arial";
			ctx.fillColor = this.style.color;
			ctx.fillText(content,x+w*0.5,y + h*0.75);
		}
		else 
		{
			this.DrawIcon(x+w*0.5,y+h*0.5,h/80,content,hover || enabled );
		}
	}

	if( this.prev_click_pos && this.isInsideRect( this.prev_click_pos, x,y,w,h ) )
	{
		this.consumeClick();
		return true;
	}
	return false;
}

//list of buttons
GLUIContext.prototype.Buttons = function(x,y,w,h,list,border,margin)
{
	if(!list || !list.length)
		return;

	margin = margin || 5;
	var ix = x;
	var iw = w / list.length - margin;
	for(var i = 0; i < list.length; ++i)
	{
		if( this.Button(ix,y,iw,h,list[i]) )
			return i;
		ix += iw + margin;
	}
	return -1;
}

GLUIContext.prototype.Number = function(x,y,w,h, value, delta_factor, border, color, color_hover)
{
	this.blocked_areas.push([x,y,w,h]);

	delta_factor = delta_factor || 0.001;
	this.value_changed = false;

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	var ctx = this.context;
	ctx.fillColor = color || this.style.backgroundColor;
	if(hover)
		ctx.fillColor = color_hover || this.style.backgroundColor_hover;

	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	ctx.beginPath();
	if(border == -1)
		ctx.arc(x+w*0.5,y+h*0.5,h*0.5,0,Math.PI*2);
	else if(border == 0)
		ctx.rect(x,y,w,h);
	else
		ctx.roundRect(x,y,w,h,border || this.style.borderRadius);
	ctx.fill();

	var str = value.toFixed(2);
	ctx.textAlign = "center";
	ctx.font = ((h * 0.75)|0) + "px Arial";
	ctx.fillColor = this.style.color;
	ctx.fillText(str,x+w*0.5,y + h*0.75);

	var clicked = false;
	clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	if(clicked)
	{
		var delta = this.mouse.position[0] - this.last_pos[0];
		var old_value = value;
		value += delta * delta_factor;
		if( value != old_value )
			this.value_changed = true;
	}

	var fast_click = this.prev_click_pos && this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,w,h ) && this.last_click_time && this.last_click_time < 250;
	if(fast_click)
	{
		var r = prompt();
		if(r != null)
			value = Number(r);
		this.last_click_time = 0;
	}

	return value;
}

GLUIContext.prototype.Toggle = function(x,y,w,h,content,enabled,color,color_hover,border)
{
	this.blocked_areas.push([x,y,w,h]);
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;
	this.value_changed = false;

	var ctx = this.context;
	if(content != null)
	{
		if(content.constructor === String)
		{
			ctx.textAlign = "left";
			ctx.font = ((h * 0.75)|0) + "px Arial";
			ctx.fillStyle = "white";
			ctx.fillText(content,x,y + h*0.75);
		}
		else 
		{
			this.DrawIcon(x+h*0.5,y+h*0.5,h/this.icon_size,content,hover || enabled,[0,1,1,1] );
		}
	}

	if( this.Button( x + w - h,y,h,h, null, enabled, color, enabled ? [1,1,1,1] : color_hover, border ) )
	{
		enabled = !enabled;
		this.value_changed = true;
	}

	return enabled;
}

GLUIContext.prototype.Combo = function(x,y,w,h,selected_index,values)
{
	if(!values)
		throw("combo values missing");
	var old_value = selected_index;
	var item_height = h / values.length;
	this.value_changed = false;
	for(var i = 0; i < values.length; ++i)
	{
		var r = this.Toggle(x,y + item_height * i, w, item_height * 0.9, values[i], i==selected_index, null,null,-1);
		if(r)
			selected_index = i;
	}
	if( selected_index != old_value )
		this.value_changed = true;
	return selected_index;
}


GLUIContext.prototype.ComboLine = function( x,y,w,h, selected_index, values, id )
{
	if(!values)
		throw("combo values missing");

	var old_value = selected_index;
	this.value_changed = false;

	if( this.Button(x,y,h,h, GLUI.icons.left ) )
	{
		selected_index = (selected_index - 1) % values.length;
		if( selected_index == -1 )
			selected_index = values.length - 1;
	}

	if( this.Button(x + h,y,w - h*2,h, selected_index != -1 ? String( values[selected_index] ) : "" )  )
	{
		//show menu
		this.ShowContextMenu(values,null,id);
	}

	if( this._prev_pending_assign && this._prev_pending_assign.id == values )
	{
		selected_index = this._prev_pending_assign.value;
		this.value_changed = true;
		this._prev_pending_assign = null;
	}

	if( this.Button(x + w - h,y,h,h, GLUI.icons.right ) )
	{
		selected_index = (selected_index + 1) % values.length;
	}

	return selected_index;
}

/*
GLUIContext.prototype.ShowContextMenu = function(x,y,selected, values)
{
	var w = 200;
	var h = values.length * 24 + 20;
	var ctx = this.context;

	ctx.fillColor = [0,0,0,1];
	ctx.fillRect(x,y,w,h);

	y += 10;
	for(var i = 0; i < values.length; ++i)
	{
		var st = this.HoverArea(x + 10, y, w - 20, 24);
		GUI.Label(x + 10, y, w - 20, 24, values[i], selected == i ? [1,1,1,1] : [1,1,1,0.5] );
		if( st === GLUI.CLICKED )
			selected = i;
		y += 24;
	}

	return selected;
}
*/

GLUIContext.prototype.Slider = function(x,y,w,h,value,min,max,step,marker)
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;
	var range = max - min;
	var f = Math.clamp( (value - min) / range, 0, 1 );
	this.value_changed = false;
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	var r = h*0.4; //ball radius

	var ctx = this.context;

	if( marker != null )
	{
		var marker_pos = (marker - min) / range;
		if(marker_pos >= 0 && marker_pos <= 1)
		{
			marker_pos = marker_pos * w;
			ctx.fillColor = [0.5,0.5,0.5,0.5];
			ctx.fillRect(x + marker_pos,y,h*0.1,h);
		}
	}

	ctx.fillColor = [0.02,0.02,0.02,1.0];
	ctx.beginPath();
	ctx.roundRect(x + r,y + h*0.4,w-r*2,h*0.2,2);
	ctx.fill();

	if( hover || clicked )
		ctx.fillColor = [0.5,0.5,0.5,1.0];
	else
		ctx.fillColor = [0.4,0.4,0.4,1.0];
	ctx.beginPath();
	ctx.arc(x+r + f*(w-r*2),y + h*0.5,r,0,Math.PI*2);
	ctx.fill();

	//console.log( this.last_click_pos, this.mouse.dragging );

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		f = ((this.mouse.position[0] - (x+r)) / (w-r*2));
		f = Math.clamp(f,0,1);
		var old_value = value;
		value = f * range + min;
		if(step)
			value = Math.round(value / step) * step;
		var xpos = x + f * w;
		ctx.fillColor = [0.3,0.3,0.3,1];
		ctx.fillRect( xpos - 45, y - 40, 90, 30 );
		ctx.fillColor = [0.8,0.8,0.8,1];
		ctx.textAlign = "center";
		ctx.fillText( value.toFixed(step >= 1 ? 0 : 2), xpos, y - 15 );
		if( value != old_value )
			this.value_changed = true;
	}
	
	return value;
}

GLUIContext.prototype.Knob = function(x,y,w,h,value,min,max,step, num_markers )
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;
	var range = max - min;
	var f = Math.clamp( (value - min) / range, 0, 1 );
	this.value_changed = false;
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	var r = h*0.4; //ball radius

	var ctx = this.context;
	var cx = x + w * 0.5;
	var cy = y + h * 0.5;
	var r = h * 0.5;

	var start_arc = 0.12 + 0.25; //percentaje of circle
	var range_arc = 0.75; 

	//ruler
	if( num_markers !== 0 )
	{
		ctx.fillColor = [0.3,0.3,0.3];
		ctx.save();
		ctx.translate(cx,cy);
		var num = num_markers || 2;
		for(var i = 0; i < num; ++i)
		{
			var ang = (start_arc + (i/(num-1)) * range_arc) * Math.PI * 2;
			ctx.save();
			ctx.rotate(ang);
			ctx.fillRect(r*1.15-2,0,10,4);
			ctx.restore();
		}
		ctx.restore();
	}

	//ball
	ctx.fillColor = [0.02,0.02,0.02,1.0];
	ctx.beginPath();
	ctx.arc(cx,cy,r,0,Math.PI * 2);
	ctx.fill();

	var main_color = [0.4,0.4,0.4,1.0];
	if( hover || clicked )
		main_color = [0.5,0.5,0.5,1.0];
	ctx.fillColor = main_color;

	//arc
	ctx.save();
	ctx.translate(cx,cy);
	ctx.rotate( start_arc * Math.PI * 2 );
	ctx.beginPath();
	ctx.moveTo(0,0);
	ctx.arc(0,0,r*0.9,0,f * range_arc * Math.PI * 2,false);
	ctx.fill();
	ctx.restore();

	//filling
	ctx.fillColor = [0.08,0.08,0.08,1.0];
	ctx.beginPath();
	ctx.arc(cx,cy,r*0.75,0,Math.PI * 2);
	ctx.fill();

	//marker
	var ang = (start_arc + f * range_arc) * Math.PI * 2;
	ctx.save();
	ctx.translate(cx,cy);
	ctx.rotate(ang);
	var main_color = [0.5,0.5,0.5,1.0];
	if( hover || clicked )
		main_color = [0.8,0.8,0.8,1.0];
	ctx.fillColor = main_color;
	ctx.beginPath();
	ctx.arc(r*0.6,0,r*0.1,0,Math.PI * 2);
	ctx.fill();
	ctx.restore();

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		var dx = this.mouse.position[0] - cx;
		var dy = this.mouse.position[1] - cy;
		var ang = Math.atan2( dy, dx ) - start_arc * Math.PI * 2;
		ang = ang % (Math.PI * 2);
		if( ang < 0 ) ang = Math.PI * (2.0) + ang;
		if(ang > (Math.PI * 2 * range_arc))
		{
			var dist = ang / (Math.PI * 2) - range_arc;
			f = dist > ((1-range_arc)*0.5) ? 0 : 1;
		}
		else
		{
			f = ang / (range_arc * Math.PI * 2);
			f = Math.clamp(f,0,1);
		}
		var old_value = value;
		value = f * range + min;
		if(step)
			value = Math.round(value / step) * step;
		var xpos = x + f * w;
		if( value != old_value )
			this.value_changed = true;
	}
	
	return value;
}


GLUIContext.prototype.Pad2D = function(x,y,w,h,value,minx,maxx,miny,maxy)
{
	this.blocked_areas.push([x,y,w,h]);
	if(minx == null) minx = -1;
	if(miny == null) miny = -1;
	if(maxx == null) maxx = 1;
	if(maxy == null) maxy = 1;
	value = value || 0;
	var rangex = maxx - minx;
	var rangey = maxy - miny;
	var fx = Math.clamp( (value[0] - minx) / rangex, 0, 1 );
	var fy = Math.clamp( (value[1] - miny) / rangey, 0, 1 );
	this.value_changed = false;
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	var r = 10; //ball radius

	var ctx = this.context;

	ctx.fillColor = [0.02,0.02,0.02,1.0];
	ctx.beginPath();
	ctx.roundRect(x,y,w,h,4);
	ctx.fill();

	ctx.fillColor = [0.2,0.2,0.2,1];
	ctx.fillRect(x,y+h*0.5,w,2);
	ctx.fillRect(x+w*0.5,y,2,h);

	if( hover || clicked )
		ctx.fillColor = [0.5,0.5,0.5,1.0];
	else
		ctx.fillColor = [0.4,0.4,0.4,1.0];
	ctx.beginPath();
	ctx.arc(x+r + fx*(w-r*2),y+r + fy*(h-r*2),r,0,Math.PI*2);
	ctx.fill();

	//console.log( this.last_click_pos, this.mouse.dragging );

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		fx = ((this.mouse.position[0] - (x+r)) / (w-r*2));
		fy = ((this.mouse.position[1] - (y+r)) / (h-r*2));
		fx = Math.clamp(fx,0,1);
		fy = Math.clamp(fy,0,1);
		var old_valuex = value[0];
		var old_valuey = value[1];
		value[0] = fx * rangex + minx;
		value[1] = fy * rangey + miny;
		//if(step)
		//	value = Math.round(value / step) * step;
		if( value[0] != old_valuex || value[1] != old_valuey )
			this.value_changed = true;
	}
	
	return value;
}

GLUIContext.prototype.createScrollArea = function( width, height, total_height )
{
	return {
			width: width,
			height: height,
			total_height: total_height,
			scroll: 0,
			target: 0
		};
}

GLUIContext.prototype.ScrollableArea = function( scroll_area, x,y,w,h, callback, param )
{
	if(!scroll_area)
		throw("no scroll area");

	var ctx = this.context;

	scroll_area.scroll = Math.lerp( scroll_area.scroll, scroll_area.target, 0.1 );

	var size = 20;
	var margin = 4;
	var list_height = h;
	
	var starty = y;
	ctx.fillColor = [0.1,0.1,0.1,0.9];
	ctx.beginPath();
	ctx.roundRect( x,starty,w,list_height, 5 );
	ctx.fill();

	ctx.save();
	ctx.beginPath();
	ctx.rect(x,y,w,list_height);
	ctx.clip();

	if( callback )
		callback(x,y+10,w,h-20,param);

	scroll_area.scroll = this.Scrollbar( x + w - 10, y+10, 8, h-20, scroll_area.scroll, scroll_area.total, h );

	ctx.restore();

	return y + h;
}

GLUIContext.prototype.Scrollbar = function(x,y,w,h,value,max,view_size)
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;

	view_size = view_size || h;
	var scroll_ratio = (view_size / max);
	var scroll_length = scroll_ratio * h;
	var scrollable_dist = h - scroll_length;
	var f = Math.clamp( value / (max - scroll_length), 0, 1 );

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );

	var ctx = this.context;
	ctx.fillColor = hover ? [0.2,0.2,0.2,1] : [0.1,0.1,0.1,1];
	ctx.beginPath();
	ctx.roundRect(x,y,w,h,10);
	ctx.fill();

	if( max < view_size )
		return value;

	ctx.fillColor = hover ? [0.8,0.8,0.8,1] : [0.5,0.5,0.5,1];
	ctx.beginPath();
	ctx.roundRect(x,y + f * scrollable_dist,w,scroll_length,10);
	ctx.fill();

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		//compute where it clicked
		f = (this.mouse.position[1] - y - 20) / (h - 40);
		f = Math.clamp(f,0,1);
		value = f * (max - scroll_length);

		/*
		f = ((this.mouse.position[1] - (x+r)) / (w-r*2));
		f = Math.clamp(f,0,1);
		var old_value = value;
		value = f * range + min;
		*/
	}

	return value;
}


GLUIContext.prototype.Progress = function(x,y,w,h,value,min,max)
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;
	var range = max - min;
	var f = Math.clamp( (value - min) / range, 0, 1 );

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var ctx = this.context;
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(x,y,w,h,10);
	ctx.clip();

	ctx.fillColor = [0.1,0.1,0.1,1];
	ctx.fillRect(x,y,w,h);

	ctx.fillColor = [0.6,0.8,1,1];
	ctx.fillRect(x,y,w * f,h);

	ctx.restore();

}

GLUIContext.prototype.DrawIcon = function(x,y,s,icon,reversed,color,image_url)
{
	var ctx = this.context;
	var canvas = ctx.canvas;
	if(color)
	{
		ctx.tintImages = true;
		ctx.fillColor = color;
	}
	image_url = image_url || this.icons;
	var img = null;
	if(ctx.webgl_version)
	{
		img = gl.textures[image_url];
		if(!img)
			img = gl.textures[image_url] = GL.Texture.fromURL(image_url,{ minFilter: GL.LINEAR_MIPMAP_LINEAR, anisotropic: 8 });
	}
	else
		img = this._icons_texture;
	if(!img || !img.width)
		return;

	if(reversed)
		ctx.globalCompositeOperation = "difference";
	var size = this.icon_size*s;
	ctx.drawImage( img, icon[0]*this.icon_size, icon[1]*this.icon_size, this.icon_size,this.icon_size, x - s*this.icon_size*0.5, y - s*this.icon_size*0.5,size,size);
	ctx.globalCompositeOperation = "source-over";
	ctx.tintImages = false;
}

GLUIContext.prototype.TextField = function(x,y,w,h, text, border, editable, is_password, keep_focus_on_intro, on_intro )
{
	if(this.tab_to_next == 1)
	{
		this.tab_to_next = 0;
		this.prev_click_pos = [x+1,y+1];
	}

	if( text == null )
		text = "";

	this.value_changed = false;
	this.blocked_areas.push([x,y,w,h]);
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var is_selected = editable && this.prev_click_pos && this.isInsideRect( this.prev_click_pos, x,y,w,h );
	max_length = 100;

	var ctx = this.context;
	if(border == null)
		border = 6;
	ctx.fillColor = this.style.backgroundColor;
	ctx.beginPath();
	ctx.roundRect(x,y,w,h,border);
	ctx.fill();			
	
	ctx.textAlign = editable ? "left" : "center";
	ctx.font = ((h * 0.75)|0) + "px Arial";
	ctx.fillColor = hover ? [0.9,0.9,0.9,1] : this.style.color;

	this.pressed_enter = false;
	if(is_selected)
	{
		var keys = this.keys_buffer;
		for( var i = 0; i < keys.length; ++i )
		{
			var key = keys[i];
			if(key.constructor === String) //pasted text
			{
				text += key;
				continue;
			}

			if( key.keyCode == 86 && key.ctrlKey ) //paste
				continue;

			switch(key.keyCode)
			{
				case 8: text = text.substr(0, text.length - 1 ); break; //backspace
				case 9: this.tab_to_next = 1; break; //tab
				case 13: 
					this.pressed_enter = true;
					if(!keep_focus_on_intro)
						this.last_click_pos = null;
					if(on_intro)
					{
						var r = on_intro(text);
						if(r != null)
							text = r;
					}
					break; //return
				case 32: if(text.length < max_length) text += " "; break; //space
				default:
					if(text.length < max_length && key.key && key.key.length == 1) //length because control keys send a string like "Shift"
						text += key.key;
					/*
					if( key.keyCode >= 65 && key.keyCode <= 122 ) //letters
						text += key.shiftKey ? key.character.toUpperCase() : key.character.toLowerCase();
					*/
			}
			this.value_changed = true;
			//console.log(key.charCode, key.keyCode, key.character, key.which, key );
		}
		keys.length = 0; //consume them
	}

	this.capture_keys |= is_selected;

	var cursor = "";
	if( is_selected && (((getTime() * 0.002)|0) % 2) == 0 )
		cursor = "|";

	var final_text = text;
	if(is_password)
	{
		final_text = "";
		for(var i = 0; i < text.length; ++i)
			final_text += "*";
	}

	if(!is_selected) //clip
	{
		ctx.save();
		ctx.beginPath();
		ctx.rect(x,y,w,h);
		ctx.clip();
	}

	ctx.fillText( final_text + cursor, x + (!editable ? w * 0.5 : 10), y + h * 0.8 );
	//ctx.fillText( text, x + w * 0.5, y + h * 0.8 );
	if(!is_selected)
		ctx.restore();
	
	/* not working well
	var fast_click = is_selected && this.prev_click_pos && this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,w,h ) && this.last_click_time && this.last_click_time < 250;
	if(fast_click)
	{
		var r = prompt();
		if(r != null)
			text = r;
		this.last_click_time = 0;
		this.consumeClick();
	}
	*/

		/*
		this.prev_click_pos = null; //cancel it
		var str = prompt("Select a name for the session", EDITOR.session_name || "");
		if(str != null)
			return str;
		*/

	return text;
}

GLUIContext.prototype.Vector = function(x,y,w,h, data, delta, border )
{
	var num = data.length;
	var iw = w / num;
	var margin = h * 0.2;
	var changed = false;
	this.value_changed = false;
	for(var i = 0; i < num; ++i)
	{
		//this.TextField(x + iw*i, y, iw - 10,h, data[i].toFixed(2) );
		data[i] = this.Number(x + iw*i, y, iw + (i < num - 1 ? -margin : 0 ),h, data[i], delta, border );
		changed = changed || this.value_changed;
	}

	this.value_changed = changed;
}

GLUIContext.prototype.Color3 = function( x,y,w,h, color, picker_area )
{
	var ctx = this.context;
	if(!color || !color.length || color.length < 3)
		return;

	var canvas = ctx.canvas;
	ctx.fillColor = [0,0,0,1];
	ctx.beginPath();
	ctx.roundRect(x-4,y-4,w+8,h+8,this.style.borderRadius);
	ctx.fill();

	var picker_size = canvas.height * 0.6;
	if(!picker_area)
		picker_area = [(canvas.width - picker_size) * 0.5, (canvas.height - picker_size) * 0.5, picker_size,picker_size]

	if( this.Button(x,y,w,h,null,true,color,color) )
	{
		if( !this.active_widget_reference || (this.active_widget_reference && this.active_widget_reference.value != color) )
			this.active_widget_reference = {
				value: color,
				area: picker_area
			};
		else
		{
			this.active_widget_reference = this.prev_active_widget_reference = null;
		}
	}

	var edited = false;

	if( this.active_widget_reference && this.active_widget_reference.value == color )
	{
		ctx.fillColor = color;
		ctx.beginPath();
		ctx.roundRect(x,y,w,h,6);
		ctx.fill();
		edited = this.Color3Picker(picker_area[0],picker_area[1],picker_area[2],picker_area[3], color);		
	}
	return edited;
}

GLUIContext.prototype.Color3Picker = function( x,y,w,h, color )
{
	if(!this.context.webgl_version)
		return; //not supported in canvas mode (yet)

	if(!gl.shaders["palette"])
	{
		gl.shaders["palette"] = new GL.Shader( GL.Shader.SCREEN_VERTEX_SHADER, "\
		precision highp float;\n\
		varying vec3 v_wPosition;\n\
		varying vec3 v_wNormal;\n\
		varying vec2 v_coord;\n\
		\n\
		uniform int u_linear;\n\
		uniform float u_hue;\n\
		\n\
		vec3 hsv2rgb(vec3 c)\n\
		{\n\
			vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);\n\
			vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n\
			return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n\
		}\n\
		\n\
		void main() {\n\
			if(u_linear == 0)\n\
				gl_FragColor = vec4( hsv2rgb( vec3(v_coord.x,1.0,1.0 ) ), 1.0 );\n\
			else\n\
				gl_FragColor = vec4( hsv2rgb( vec3(u_hue, v_coord ) ), 1.0 );\n\
		}\n\
		");
	}
	var ctx = this.context;

	var shader = gl.shaders["palette"];
	var mouse_position = this.mouse.position;

	this.blocked_areas.push([x,y,w,h]);

	if(!this.palette)
	{
		this.palette = new GL.Texture(256,256);
		this.palette_hue = new GL.Texture(256,1);
		this.palette_hue.fill( shader.uniforms({u_linear:0}) );
	}

	var hue_sat_lum = vec3.create();
	var picker = vec2.create();

	RGBtoHSV(color, hue_sat_lum);
	picker[0] = hue_sat_lum[1];
	picker[1] = 1 - hue_sat_lum[2];

	//fills texture
	this.palette.fill( shader.uniforms({u_linear:1,u_hue: hue_sat_lum[0]}) );

	var size = w;

	ctx.fillStyle = "black";
	ctx.fillRect(x-4,y-4,w+8,h+8);

	ctx.drawImage(this.palette, x,y,w,h-20 );
	ctx.drawImage(this.palette_hue, x,y+h-20,w,20);
	ctx.globalAlpha = 1;
	ctx.fillStyle = "black";
	ctx.fillRect( x + picker[0] * w - 4,y + picker[1] * (h-20) - 4,8,8);
	ctx.fillStyle = "white";
	ctx.fillRect( x + picker[0] * w - 2,y + picker[1] * (h-20) - 2,4,4);

	ctx.fillRect( x + hue_sat_lum[0] * w - 2,y + (h-22),4,24);

	if( this.wasMouseClicked() && this.isInsideRect( mouse_position,x,y,w,h) )
		this.dragging_widget = "picker";
	if( this.wasMouseClicked() && this.isInsideRect( mouse_position,x,y + (h-20),w,20) )
		this.dragging_widget = "hue";

	if( !this.mouse.dragging )
		this.dragging_widget = null;

	if(this.dragging_widget == "picker" )
	{
		picker[0] = Math.clamp( (mouse_position[0] - x) / w,0,1);
		picker[1] = Math.clamp( (mouse_position[1] - y) / (h-20),0,1);
		var c = HSVtoRGB( hue_sat_lum[0], picker[0], 1 - picker[1] );
		color[0] = c[0]; color[1] = c[1]; color[2] = c[2];
	}

	if(this.dragging_widget == "hue" )
	{
		hue_sat_lum[0] = Math.clamp( (mouse_position[0] - x) / w,0,1);
		var c = HSVtoRGB( hue_sat_lum[0], picker[0], 1 - picker[1] );
		color[0] = c[0]; color[1] = c[1]; color[2] = c[2];
	}

	return !!this.dragging_widget;
}

GLUIContext.prototype.Panel = function(x,y,w,h, title, closable, border_radius, icon )
{
	var ctx = this.context;
	ctx.fillColor = [0.15,0.15,0.15, 0.9 * ctx.globalAlpha ];
	ctx.beginPath();
	ctx.roundRect( x, y, w,h, border_radius || 20 );
	ctx.fill();

	this.blockArea(x,y,w,h);

	if( closable && this.Button(x + w - 40,y+10,30,30,[4,2], false, [0.1,0.1,0.1,0.9],null, 10 ) )
		return false;

	if(icon)
		this.DrawIcon( x + 26, y + h * 0.5, 0.5, icon );

	if(title)
		this.Label( x + 20 + (icon ? 20 : 1), y + 15, w - 40, 30, title );

	return true;
}

GLUIContext.prototype.DropArea = function(x,y,w,h, callback )
{
	this.blockArea(x,y,w,h,{onFile:callback});
	return this.dragging_file;
}

//displays a Confirm dialog, returns true if clicked yes, false if clicked no, otherwise null
GLUIContext.prototype.Confirm = function( text )
{
	var ctx = this.context;
	var x = 0;
	var y = 0;
	var w = ctx.canvas.width;
	var h = ctx.canvas.height;

	//ctx.fillColor = [0.1,0.1,0.1, 0.5 * ctx.globalAlpha ];
	//ctx.fillRect( x, y, w,h );
	//this.blockArea(x,y,w,h);

	var x = w * 0.5 - 200;
	var y = h * 0.5 - 50;
	var w = 400;
	var h = 100;

	this.Panel(x,y,w,h,text);
	if( this.Button(x+10, y + 50, 180, 40, "Accept" ) )
		return true;
	if( this.Button(x+210, y + 50, 180, 40, "Cancel" ) )
		return false;
	return null;
}

GLUIContext.prototype.ShowContextMenu = function( values, callback, id )
{
	var that = this;
	var pos = that.last_pos.concat();
	pos[0] -= 10;
	pos[1] -= 10;
	var info = {
		pos: pos, 
		id: id || values, //used to reassign
		values: values,
		callback: callback,
		time: getTime()
	};

	this._prev_pending_assign = null;
	this.consumeClick();

	setTimeout( function() {
		that.context_menu = info;
	}, 10 ); //deferred to avoid reclicks
}

GLUIContext.prototype.drawContextMenu = function( context_menu )
{
	if(!context_menu)
		return false;

	var ctx = this.context;

	var x = context_menu.pos[0];
	var y = context_menu.pos[1];
	var values = context_menu.values;
	var w = 200;
	var h = values.length * 24 + 20;
	if( x + w > ctx.canvas.width )
		x = ctx.canvas.width - w;
	if( y + h > ctx.canvas.height )
		y = ctx.canvas.height - h;

	var now = getTime();

	if( !this.isInsideRect( this.mouse.position, x,y,w,h ) )
	{
		//clicked outside
		if(this.last_click_pos && !this.isInsideRect( this.last_click_pos, x,y,w,h ))
		{
			this.consumeClick();
			return true;
		}

		if( now > context_menu.time + 2000 )
			return true;
	}
	else
		context_menu.time = now;


	ctx.fillColor = [0,0,0,1];
	ctx.fillRect(x,y,w,h);
	
	y += 10;
	var selected = -1;
	for(var i = 0; i < values.length; ++i)
	{
		var st = this.HoverArea(x + 10, y, w - 20, 24);
		if(values[i] == null)
		{
			ctx.fillColor = [0.2,0.2,0.2,0.5];
			ctx.fillRect(x+5,y+12,w-10,2);
		}
		else
		{
			if(st == GLUI.HOVER)
			{
				ctx.fillColor = [0.1,0.1,0.1,1];
				ctx.fillRect(x+5,y,w-10,24);
			}
			GUI.Label(x + 10, y, w - 20, 24, values[i], (context_menu.selected == i || st === GLUI.HOVER) ? [1,1,1,1] : [1,1,1,0.5] );
			if( st === GLUI.CLICKED )
				selected = i;
		}
		y += 24;
	}

	if( selected != -1 )
	{
		this.consumeClick();
		if( context_menu.callback )
			context_menu.callback( selected, values[selected] );
		else
			this._prev_pending_assign = { id: context_menu.id, value: selected };
		return true;
	}

	return false;
}

//*****************************************************

function HSVtoRGB(h, s, v) {
    var r, g, b, i, f, p, q, t;
    if (arguments.length === 1) {
        s = h[1], v = h[2], h = h[0];
    }
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return [r,g,b];
}

function RGBtoHSV(color, out) {
    var r = color[0];
    var g = color[1];
    var b = color[2];

    var max = Math.max(r, g, b), min = Math.min(r, g, b),
        d = max - min,
        h,
        s = (max === 0 ? 0 : d / max),
        v = max;

    switch (max) {
        case min: h = 0; break;
        case r: h = (g - b) + d * (g < b ? 6: 0); h /= 6 * d; break;
        case g: h = (b - r) + d * 2; h /= 6 * d; break;
        case b: h = (r - g) + d * 4; h /= 6 * d; break;
    }

	out = out || new Float32Array(color.length);
	out[0] = h;
	out[1] = s;
	out[2] = v;
	if(color.length > 3) //alpha
		out[3] = color[3];
    return out;
}

if (typeof(window) != "undefined" && window.CanvasRenderingContext2D) {

	if(!window.CanvasRenderingContext2D.prototype.hasOwnProperty("fillColor") )
	{
		Object.defineProperty( window.CanvasRenderingContext2D.prototype, "fillColor", {
			set: function(v)
			{
				if(!this._fillColor)
					this._fillColor = new Float32Array([1,1,1,1]);
				this._fillColor.set(v);
				if(v.length == 3)
					this.fillStyle = "#" + ((v[0]*256)|0).toString(16) + 
											((v[1]*256)|0).toString(16) + 
											((v[2]*256)|0).toString(16);
				else if(v.length == 4)
				{
					this.globalAlpha = v[3];
					this.fillStyle = "rgba(" + ((v[0]*255)|0).toFixed(3) + "," +
												((v[1]*255)|0).toFixed(3) + "," +
												((v[2]*255)|0).toFixed(3) + "," +
												v[3].toFixed(3) + ")";
				}
			},
			get: function()
			{
				this._fillColor[3] = this.globalAlpha;
				return this._fillColor;
			}
		});
	}

	if(!window.CanvasRenderingContext2D.prototype.roundRect)
		window.CanvasRenderingContext2D.prototype.roundRect = function(
		x,
		y,
		width,
		height,
		radius,
		radius_low
	) {
		if (radius === undefined) {
			radius = 5;
		}

		if (radius_low === undefined) {
			radius_low = radius;
		}

		if(radius <= 0 && radius_low <= 0)
		{
			this.rect(x,y,width,height);
			return;
		}

		this.moveTo(x + radius, y);
		this.lineTo(x + width - radius, y);
		this.quadraticCurveTo(x + width, y, x + width, y + radius);

		this.lineTo(x + width, y + height - radius_low);
		this.quadraticCurveTo(
			x + width,
			y + height,
			x + width - radius_low,
			y + height
		);
		this.lineTo(x + radius_low, y + height);
		this.quadraticCurveTo(x, y + height, x, y + height - radius_low);
		this.lineTo(x, y + radius);
		this.quadraticCurveTo(x, y, x + radius, y);
	};
}

Math.clamp = function(v,a,b) { return (a > v ? a : (b < v ? b : v)); }
Math.lerp =  function(a,b,f) { return a * (1 - f) + b * f; }
Math.lerp01 =  function(a,b,f) { return Math.clamp(a * (1 - f) + b * f,0,1); }
Math.iLerp =  function(a,b,v) { return (v - a) / (b - a); }
Math.remap =  function(v,min,max,min2,max2) { return Math.lerp(min2,max2, Math.iLerp(min,max,v)); }

if(typeof(getTime) == "undefined")
	window.getTime = performance.now.bind(performance);


//global
var GUI = new GLUIContext();
