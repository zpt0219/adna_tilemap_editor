// JavaScript Document

function hidecurs() {
	var elem = document.getElementById("over");
	var down = document.getElementById("down");
	elem.style.top = -32 + "px";
    elem.style.left = 16 + "px";
	down.style.top = -32 + "px";
    down.style.left = 16 + "px";
	g_roll=0;
}

function cursor(tile_id) {  // mouse rolled over tile
	g_move = 0;  // moved
	var tilePos = tile_id.split('_', 2);
	var col = parseInt(tilePos[0], 10);
	var row = parseInt(tilePos[1], 10);
	
	// move cursor over cell
	var elem = document.getElementById("over");
	elem.style.top  = 16*(row-1) + "px";
	elem.style.left = 16*(col-1) + "px";
	
	if (g_roll == 1) {window[g_type](col,row); }    // call function 'g_type'
}

/*function cursorte(e,tile_id) {  // touch enter tile
	cursor(tile_id);
	e.preventDefault();
	return false;
}*/
	
function operate(elem) { // cursor clicked
	var stag = document.getElementById("stage");
	var down = document.getElementById("down");
	g_roll = !g_roll;  // invert rollover
	
	if (g_roll == 1) {
		g_move = 1;  // movement
		
		//stag.style.borderColor='#ff0000';  // red stage border
		
        if (g_type == "edge" || g_type == "twin") {
			down.setAttribute("src", "../art/js/downe.gif");
			down.style.top = elem.style.top;
            down.style.left = elem.style.left; }
			
		if (g_type == "corn") {
			down.setAttribute("src", "../art/js/downc.gif");
			down.style.top = elem.style.top;
            down.style.left = elem.style.left; }
		
		if (g_type == "blob") {
			
			if (g_47 == 0) { // edges
				down.setAttribute("src", "../art/js/downe.gif");
				down.style.top = elem.style.top;
                down.style.left = elem.style.left; }
			else { // g47 must be "corn"
				down.setAttribute("src", "../art/js/downc.gif");
				down.style.top = elem.style.top;
                down.style.left = elem.style.left; }
		}
		
        // save current cusor position
        g_curx = 1+parseInt(elem.style.left, 10)/16;
        g_cury = 1+parseInt(elem.style.top, 10)/16;
		
	} else {  // g_roll=0
	
		//stag.style.borderColor='000033';  // black stage border
	
		// put away cursor
		down.setAttribute("src", "../art/js/down.gif");
		down.style.top = -32 + "px";
        down.style.left = 16 + "px";
		
		if (g_move == 1) { // unmoved
			g_47 = !g_47;  // invert g_47 edge and corners
		}	
	}
}

function block(col,row) {
	// operate if g_type = 'block'
	set_tile(col,row)
	g_curx = col; g_cury = row;  // update current position
}

function truch(col,row) {
	// operate if g_type = 'truch'
	set_tile(col,row)
	g_curx = col; g_cury = row;  // update current position
}

function set_tile(tilex,tiley) {
	// operate if g_type = 'block' or 'truch'
	g_field[tilex-1][tiley-1] = draw_valbt(g_field[tilex-1][tiley-1] );
	putcell(tilex,tiley);
}
	
function edge(col,row) {
	// operate if g_type = 'edge'
	
	var dx = (col-g_curx)/2;
	var dy = (row-g_cury)/2;
	
	if ( (Math.abs(dx)==1 && dy===0) || (Math.abs(dy)==1 && dx===0) ) {  // adjacent edge tiles

		set_edge(g_curx,g_cury,dx,dy);
		
		// move 'down' cursor to 'over' position
		var elem = document.getElementById("over");
		var down = document.getElementById("down");
		down.style.top = elem.style.top;
        down.style.left = elem.style.left;
		
		g_curx = col; g_cury = row;  // update current position
	}
}

function set_edge(tilex,tiley,dx,dy){
	// set edge and update stage
	
	var val = draw_val( g_field[tilex+dx][tiley+dy] );
	// if ( g_field[tilex+dx][tiley+dy] == val ) {return; }  // same
    
	g_field[tilex+dx][tiley+dy] = val;  // update edge value
	putcell(tilex,tiley);
	putcell(tilex+2*dx,tiley+2*dy);
}

function corn(col,row) {
	// operate if g_type = 'corn'
	var dx = (col-g_curx)/2;
	var dy = (row-g_cury)/2;
	
	if (Math.abs(dx)==1 && Math.abs(dy)==1) {  // diagonally adjacent tiles
	
		set_corn(g_curx,g_cury,dx,dy);
		
		// move 'down' cursor to 'over' position
		var elem = document.getElementById("over");
		var down = document.getElementById("down");
		down.style.top = elem.style.top;
        down.style.left = elem.style.left;
		
		g_curx = col; g_cury = row;  // update current position
	}
}

function set_corn(tilex,tiley,dx,dy){
	// set corner and update stage
	
	var val = draw_val( g_field[tilex+dx][tiley+dy] );
	// if ( g_field[tilex+dx][tiley+dy] == val ) {return; }  // same
    
	g_field[tilex+dx][tiley+dy] = val;
	putcell(tilex,tiley);
	putcell(tilex+2*dx,tiley);
	putcell(tilex,tiley+2*dy);
	putcell(tilex+2*dx,tiley+2*dy);
}

function blob(col,row) {
	// operate if g_type = 'blob'
	var elem,down;
	
	/*var midx = (col+g_curx)/2;
	var midy = (row+g_cury)/2;*/
	var dx = (col-g_curx)/2;
	var dy = (row-g_cury)/2;
	
	if (g_47 == 0) { // edges!!
	
	if ( (Math.abs(dx)==1 && dy===0) || (Math.abs(dy)==1 && dx===0) ) {  // perpendicular adjacent tiles

		set_blob_edge(g_curx,g_cury,dx,dy);
		
		// move 'down' cursor to 'over' position
		elem = document.getElementById("over");
		down = document.getElementById("down");
		down.style.top = elem.style.top;
        down.style.left = elem.style.left;
		
		g_curx = col; g_cury = row;  // update current position
	} }
	
	else { // corners!!
	
	if (Math.abs(dx)==1 && Math.abs(dy)==1) {  // diagonally adjacent tiles
	
		set_blob_corn(g_curx,g_cury,dx,dy);
		
		// move 'down' cursor to 'over' position
		elem = document.getElementById("over");
		down = document.getElementById("down");
		down.style.top = elem.style.top;
        down.style.left = elem.style.left;
		
		g_curx = col; g_cury = row;  // update current position
	} }
}

function set_blob_edge(tilex,tiley,dx,dy) {
	
	var val = draw_val( g_field[tilex+dx][tiley+dy] );
	// if ( g_field[tilex+dx][tiley+dy] == val ) {return; }  // same
    
	g_field[tilex+dx][tiley+dy] = val;
	// if edge has been changed to '0', make 2! adj corners '0'
    if (val === 0) {  
		g_field[tilex+dx+dy][tiley-dx+dy] = 0;
    	g_field[tilex+dx-dy][tiley+dx+dy] = 0;
    	// and update 4 outer tiles
		putcell_test(tilex+2*dx+2*dy,tiley-2*dx+2*dy);
    	putcell_test(tilex+2*dx-2*dy,tiley+2*dx+2*dy);
    	putcell_test(tilex+2*dy,tiley-2*dx);
    	putcell_test(tilex-2*dy,tiley+2*dx);
		}
	// update 2 tiles
	putcell(tilex,tiley);
	putcell(tilex+2*dx,tiley+2*dy);
}

function putcell_test(col,row) {
	if (col<0 || row<0 || col>g_fwide-1 || row>g_fhigh-1) {return; }  // outside stage
	else putcell(col,row);
}

function set_blob_corn(tilex,tiley,dx,dy) {
	
	var val = draw_val( g_field[tilex+dx][tiley+dy] );
	//if ( g_field[tilex+dx][tiley+dy] == val ) {return; }  // same
    
	g_field[tilex+dx][tiley+dy] = val;
	// if c has been changed to a '1', make all 4! adj edges a '1'
    if (val === 1) {  
		g_field[tilex+dx][tiley] = 1;
    	g_field[tilex][tiley+dy] = 1;
		g_field[tilex+2*dx][tiley+dy] = 1;
    	g_field[tilex+dx][tiley+2*dy] = 1;
		
		//g_field[(tilex+2*dx)%g_fwide][tiley+dy] = 1;  // within field
    	//g_field[tilex+dx][(tiley+2*dy)%g_fhigh] = 1;  // within field
		}
	// update 4 tiles
	putcell(tilex,tiley);
	putcell(tilex+2*dx,tiley);
	putcell(tilex,tiley+2*dy);
	putcell(tilex+2*dx,tiley+2*dy);
}

function twin(col,row) {
	// operate if g_type = 'twin'
	var elem = document.getElementById("over");
	var down = document.getElementById("down");
	
	if (g_curx%4 + g_cury%4 !== 4) { // (1+3)or(3+1) intersection tile	
		var dx = (col-g_curx)/4;
		var dy = (row-g_cury)/4;
		if ( (Math.abs(dx)==1 && dy === 0) || (Math.abs(dy)==1 && dx === 0) ) {  // adjacent+1 edge tiles
		
			set_twin(g_curx,g_cury,dx,dy);
		
			// move 'down' cursor to 'over' position
			down.style.top = elem.style.top;
        	down.style.left = elem.style.left;
		
			g_curx = col; g_cury = row;  // save current position
		}
	} else { // not an intersection tile
		// move 'down' cursor to 'over' position
		down.style.top = elem.style.top;
        down.style.left = elem.style.left;
		g_curx = col; g_cury = row;  // save current position
	}
}

function set_twin(tilex,tiley,dx,dy) {
	// set 2! edges and update stage
	
	var val = draw_val( g_field[tilex+dx][tiley+dy] );
	// if ( g_field[tilex+dx][tiley+dy] == val ) {return; }  // same
    
	g_field[tilex+dx][tiley+dy] = val;
	g_field[tilex+3*dx][tiley+3*dy] = val;
	
	putcell(tilex,tiley);
	putcell(tilex+2*dx,tiley+2*dy);
	putcell(tilex+4*dx,tiley+4*dy);
}

function cellname(col,row) {  // find cell id
    return col + "_" + row;
}

function stageTitle(title) {   
    // set title above stage
    document.getElementById('title').innerHTML = title;
}

function output() {   
    // output cells
	var title = document.getElementById("title").innerHTML;
	
    var content = document.getElementById("op");
	content.textContent = "";  // clear text
	content.textContent = title + " " + g_wide + " x " + g_high + '\n'; // + g_field.toString(); 
	var row,col;
    for (row = 1; row < g_fhigh-1; row+=1) {  // all cells
		var roww = [];
        for (col = 1; col < g_fwide-1; col+=1) {
			roww.push(g_field[col][row]);
		}
		content.textContent += ("[" + roww + "]" + '\n');
    }
}

function input() {   
    // input cells
	var content = document.getElementById("op").textContent; 
	var row,col;
    for (row = 1; row < g_fhigh-1; row+=1) {  // all cells
		for (col = 1; col < g_fwide-1; col+=1) {
			if ((row%2) && (col%2)) {}
			else {
				g_field[col][row] = content[col][row]; 
			}
		}
    }
}

/////////////////////

function putcell(col,row) {  // set midd cell value and tile img
	var func = g_type + "_value";  // function 'g_type'
	var val = window[func](col,row,g_order);
    g_field[col][row] = val;    // update midd cell value
    settileImg(col,row,val);    // update tile img
}

function settileImg(col,row,val) {  // update tile img, by offsets!!
    //var imgpath = imgpat() + val + ".gif";
	//document.getElementById(cellname(col,row)).src = imgpath;
	var funcx = g_type + g_order + "_x";
	var funcy = g_type + g_order + "_y";
	cell = document.getElementById(cellname(col,row));
	cell.style.backgroundPosition = window[funcx](val) + 'px ' + window[funcy](val) + 'px';
}

function puttileImg(col,row,x,y) {  // update tile img, by offsets!!
    cell = document.getElementById(cellname(col,row));
	cell.style.backgroundPosition = -32*x + 'px ' + -32*y + 'px';
}

/////////////////////

function draw_val(val) {  // return draw value
	if (g_draw == 3) {return (3-val) % g_order; }  // swop 0-1 or 1-2 if order = 3
	else return g_draw;
}

function draw_valbt(val) {  // return draw value for block and truch tilesets
	if (g_draw == 3) {return (val+1) % g_piece; }  // add 1 to value
	else return g_draw;  // should never be 2!!
}