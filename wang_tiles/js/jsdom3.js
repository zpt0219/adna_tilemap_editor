// JavaScript Document

function tiles(type,tset) {  // set form and globals

  // put away cursors
  var down = document.getElementById("down");
  down.setAttribute("src", "../art/js/down.gif");
  down.style.top = -32 + "px";
  down.style.left = 16 + "px";
  var over = document.getElementById("over");
  over.setAttribute("src", "../art/js/over.gif");
  over.style.top = -32 + "px";
  over.style.left = 16 + "px";
  // reset a few globals
  g_curx = 0;
  g_cury = 0;
  g_roll = 0;  // rollover not active
  g_move = 1;  // movement
  g_47 = 0;  // Blob 0=edge, 1=corn
  var stag = document.getElementById("stage");
  //stag.style.borderColor='#666666';  // reset border color

// reset all menus except chosen menu
  if (type !== "truch") {document.getElementById('truch').options[0].selected = 1; }
  if (type !== "bloc2") {document.getElementById('bloc2').options[0].selected = 1; }
  if (type !== "bloc4") {document.getElementById('bloc4').options[0].selected = 1; }
  if (type !== "paths2") {document.getElementById('paths2').options[0].selected = 1; }
  if (type !== "paths3") {document.getElementById('paths3').options[0].selected = 1; }
  if (type !== "patch2") {document.getElementById('patch2').options[0].selected = 1; }
  if (type !== "patch3") {document.getElementById('patch3').options[0].selected = 1; }
  if (type !== "blob") {document.getElementById('blob').options[0].selected = 1; }
  if (type !== "twin") {document.getElementById('twin').options[0].selected = 1; }
  
  var order = 2;
  var piece = 2;
  document.getElementById("rg2").disabled = true;
  document.getElementById("inv").disabled = false;
  
  if (g_tset == "brench") setTileset_();  // recalculate tile indexes, remove any Brench Extra tiles.
  if (tset == "brench") document.getElementById("ba").disabled = false;
  else document.getElementById("ba").disabled = true;  // disable alt brench tiles
  
  if (type == "blob") {document.getElementById("inv").disabled = true; }
  
  if (tset == "none") {type = "truch"; piece = 1; }  // to 'clear' stage
  else if (tset == "tru7" || tset == "tru8") {piece = 4; }
  
  else if (type == "bloc2") {type = "block"; }
  else if (type == "bloc4") {type = "block"; piece = 4; }
  else if (type == "paths2") {type = "edge"; }
  else if (type == "paths3") {type = "edge"; order = 3; document.getElementById("rg2").disabled = false; }
  else if (type == "patch2") {type = "corn"; }
  else if (type == "patch3") {type = "corn"; order = 3; document.getElementById("rg2").disabled = false; }

	if (type == g_type && order == g_order && piece == g_piece) { // same menu
		g_tset = tset;
		setTileset();  // update tileset without recalculating tile indexes
		
		var title = document.getElementById('title').innerHTML;
		title = rlw(title) + " " + cap(g_tset);
		stageTitle(title);
		return;  // DONE
	}
	// else a new type
	g_type = type;
	g_order = order;
	g_piece = piece;
	
	if (g_auto) stop_auto();  // stop auto if running
	
		//if (g_draw == 2) { g_draw = 3; setrbs(); }   // set draw to 3 (+1) if =2 and order = 2
		//if (g_clear == 2) { g_clear = 0; }

// downgrade
	if ((g_tset == "wangtw" && tset == "wang3e") ||  
		// upgrades  [tset == "wangtw" || ]
		(g_tset == "wang2e" && (tset == "wang3e" || tset == "wangbl")) ||
		// upgrades  [tset == "wangbl" || ]
		(g_tset == "wang2c" && tset == "wang3c")) { g_tset = tset; setTiles(); return; }
	
	if ((g_tset == "wangbl" || g_tset == "wang3e") && tset == "wang2e") {
		var row,col;
		for (row = 0; row < g_fhigh-1; row++) {  // not last row
			for (col = 0; col < g_fwide-1; col+=2) {  // not last col
				if (g_field[col + (row+1)%2][row] === 2) {g_field[col + (row+1)%2][row] = 0; }  // set edge to 0 if 2
			}
		}
		g_tset = tset; setTiles(); return;
	}
	
	if ((g_tset == "wangbl" || g_tset == "wang3c") && tset == "wang2c") {
		var row,col;
		for (row = 0; row < g_fhigh-1; row+=2) {  // not last row
        	for (col = 0; col < g_fwide-1; col+=2) {  // not last col
				if (g_field[col][row] === 2) {g_field[col][row] = 0; }  // set corner to 0 if 2
			}
		}
		g_tset = tset; setTiles(); return;
	}
	
	g_tset = tset;  // update global
	rand();  // random tiles
}

function rand() {  // random button
	if (g_tset == "none") {alert ("Select a tileset"); return; }
	//if (g_auto) {stop_auto(); }  // stop auto if running
	var func = g_type + "_tiles";
	window[func]();  // call function 'g_type'
}

function clearCells(clear) {  // set all cells to clear
	var row,col;
    for (row = 0; row < g_fhigh-1; row++) {  // has to be 0 for truchet block tiles
        for (col = 0; col < g_fwide-1; col++) {			
            g_field[col][row] = clear;
		}
    }
}

function clearStage() {  // clear button, set all cells to g_clear
	if (g_tset == "none") {alert ("Select a tileset"); return; }
	var order = g_order;
	if (g_type == "block" || g_type == "truch") {order = g_piece; }
	g_clear = (g_clear+1) % order;  // advance g_clear value
	
	clearCells(g_clear);

	if (g_type == "twin") {clearBorder2(); }  // set 'inner' border to 0
	if (g_type !== "truch" && g_type !== "block") {clearBorder(); }  // preserve info
	setTiles();  // set midd field cells and stage tiles
}

function radio(val) {   // radios clicked directly
	g_draw = val;
	setrbs();
}

function setrbs() {  // set radio buttons
	// set all to 0
	document.getElementById('rg0').checked = 0;
	document.getElementById('rg1').checked = 0;
	document.getElementById('rg2').checked = 0;
	document.getElementById('rg3').checked = 0;
	var name = "rg"+g_draw;
	document.getElementById(name).checked = 1;
}

function bevel(checkboxElem) {  // toggle bevel  
  var elem  = document.getElementById("stage");
  if (checkboxElem.checked) {
	//console.log("hi");
	//elem.style.border = '2px solid red';
	//elem.style.backgroundImage = "url('../art/js/bevel.png')";
	elem.setAttribute('class','bevel');
  } else {
    //console.log("bye");
	//elem.style.border = 'none';
	//elem.style.backgroundImage = "none";
	elem.removeAttribute('class');
  }
}

function invertStage() { // invert button
	if (g_tset == "none") {alert ("Select a tileset"); return; }  // cannot invert empty stage
	if (g_type == "blob") {alert ("Blob tilesets cannot be inverted"); return; }  // cannot invert blob tileset
	
	var row,col;
	if (g_type == "block" || g_type == "truch") {
		for (row = 1; row < g_fhigh; row+=2) {
        	for (col = 1; col < g_fwide; col+=2) {
				g_field[col-1][row-1] = (g_field[col-1][row-1] + 0.5*g_piece) % g_piece;  // add half g_piece
        	}
    	}
	} else {
		
    for (row = 1; row < g_fhigh-1; row++) {
        for (col = 1; col < g_fwide-1; col++) {
			g_field[col][row] = (3-(g_field[col][row])) % g_order;  // swop 0-1 or 1-2 if order = 3
        	}
    	}
	}
	// no need for clearBorder()
	if (g_type == "twin") {clearBorder2(); }  // clear 'inner' border
	setTiles();  // set midd field cells and stage tiles
}

function clearBorder() { // set field border to 0
	var row,col;
	for (col = 0; col < g_fwide; col++) {
		g_field[col][0] = 0;  // set top row
		g_field[col][g_fhigh-1] = 0;  // set bottom row
	}
	for (row = 1; row < g_fhigh-1; row++) {
		g_field[0][row] = 0;  // set left column
		g_field[g_fwide-1][row] = 0;  // set rite column
	}
}

function clearBorder2() { // set 'inner' field border to 0 for twin tilesets
	for (col = 3; col < g_fwide-1; col+=4) {g_field[col][2] = 0; }  // top
	for (col = 1; col < g_fwide-1; col+=4) {g_field[col][g_fhigh-3] = 0; }  // bottom
	for (row = 3; row < g_fhigh-1; row+=4) {g_field[2][row] = 0; }  // left
	for (row = 1; row < g_fhigh-1; row+=4) {g_field[g_fwide-3][row] = 0; }  // rite
}

function auto() {  // toggle auto button
	if (g_auto) {stop_auto(); return; }  // stop auto if running
	if (g_tset == "none") {alert ("Select a tileset"); return; }
	var auto = document.getElementById("auto");
	auto.style.borderColor='#ff0000';  // red button border
	g_auto = setInterval(function(){twinkle()},150);	
}

function stop_auto() {
	clearInterval(g_auto); 
	g_auto = null; 
	var auto = document.getElementById("auto");
	auto.style.borderColor='#806060';  // remove 'auto' button border
}

function twinkle() {  //
	// random stage tile
	var randx = 1 + 2* Math.floor(Math.random()*g_wide);
	var randy = 1 + 2* Math.floor(Math.random()*g_high);
	// random direction
	var dx=0; var dy=0;
	while (dx===0 && dy===0) {
		dx = (Math.floor(Math.random()*3))-1;  // -1,0,1
		dy = (Math.floor(Math.random()*3))-1;  // -1,0,1
	}
		
	var func = "auto_" + g_type;  // block, edge, corn, blob, twin
	window[func](randx,randy,dx,dy);  // call function 'g_type'
}

function auto_block(randx,randy,dx,dy) { // 
	//  dx and dy ignored
	set_tile(randx,randy);
}

function auto_truch(randx,randy,dx,dy) { // 
	//  dx and dy ignored
	set_tile(randx,randy);
}

function auto_edge(randx,randy,dx,dy) { // 
	if (dx==dy) {dy=0; }
	else if (dx+dy===0) {dx=0; }
	if (randx+dx==0 || randy+dy==0 || randx+dx==g_fwide-1 || randy+dy==g_fhigh-1) {return; }  // outside stage
	set_edge(randx,randy,dx,dy);
}

function auto_corn(randx,randy,dx,dy) { // 
	if (dx===0) {dx=(-1)*dy; }
	else if (dy===0) {dy=dx; }
	if (randx+dx==0 || randy+dy==0 || randx+dx==g_fwide-1 || randy+dy==g_fhigh-1) {return; }  // outside stage
	set_corn(randx,randy,dx,dy);
}

function auto_blob(randx,randy,dx,dy) { // 
	if (randx+dx==0 || randy+dy==0 || randx+dx==g_fwide-1 || randy+dy==g_fhigh-1) {return; }  // outside stage
	if (dx===0 || dy===0) {set_blob_edge(randx,randy,dx,dy); }
	else set_blob_corn(randx,randy,dx,dy);
}

function auto_twin(randx,randy,dx,dy) { // same as edge
	if (randx%4 + randy%4 == 4) { // (1+3)or(3+1) not good
		if (randx%4 ==1) {randx+=2; } else {randx-=2; }
	}
	if (dx==dy) {dy=0; }
	else if (dx+dy===0) {dx=0; }
	if ((randx<4 && dx==-1) || (randy<4 && dy==-1) || (randx>g_fwide-5 && dx==1) || (randy>g_fhigh-5 && dy==1)) {return; }
	set_twin(randx,randy,dx,dy);
}

function maze_rand(rand) { // 
	//  set maze rand : last ratio
	g_rand = rand;
}
