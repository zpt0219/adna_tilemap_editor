// JavaScript Document  g_tset,g_order

function block_tiles() {
  var row,col;
  //random top-left 'corner' tile
    for (row = 1; row < g_fhigh; row+=2) {
        for (col = 1; col < g_fwide; col+=2) {
             g_field[col-1][row-1] = Math.floor(Math.random()*g_piece);
		}
    }
	
	if (! document.getElementById('tq').checked) {  // "Block" tiles
		stageTitle("Random "+g_piece+"-Block - "+cap(g_tset));
		
	} else {  // "Clock" tiles
		stageTitle("Random "+g_piece+"-Block* - "+cap(g_tset));
		
		//update non matching 
    for (row = 3; row < g_fhigh; row+=2) {  // not first row
        for (col = 3; col < g_fwide; col+=2) {  // not first col
			var index = g_field[col-1][row-3] + 2*g_field[col-3][row-3] + 4*g_field[col-3][row-1];
                if (index ===0) {g_field[col-1][row-1] = 1; }
                else if (index == 2) {g_field[col-1][row-1] = 0; }
                else if (index == 5) {g_field[col-1][row-1] = 1; }
                else if (index == 7) {g_field[col-1][row-1] = 0; }
		}
	}
	}	
    setTiles();  // set field cells and stage tiles
}


function truch_tiles() {
	
  // set title
	if (g_tset == "none") {stageTitle("Stage: "+ g_wide +" x "+ g_high +" tiles"); }
	else {stageTitle("Random "+g_piece+"-Truchet - "+cap(g_tset)); }

  //random top-left 'corner' tile
    var row,col;  // chequer centres
    for (row = 1; row < g_fhigh; row+=2) {
        for (col = 1; col < g_fwide; col+=2) {
            g_field[col-1][row-1] = Math.floor(Math.random()*g_piece);
		}
    }
	setTiles();  // calc midd values and set stage tiles
}


function edge_tiles() {
	
    stageTitle("Random "+g_order+"-Edge tileset - "+cap(g_tset));  // set title
  
    // random edge values
    var row,col;
    for (row = 0; row < g_fhigh-1; row++) {  // not last row
        for (col = 0; col < g_fwide-1; col+=2) {  // not last col
            g_field[col + (row+1)%2][row] = Math.floor(Math.random()*g_order);
		}
    }
	//if (g_tset == "drawn") {  // add 16 to 50% of tiles
	clearBorder();  // reset any border cells to 0
	setTiles();  // calc midd values and set stage tiles
}


function corn_tiles() {
	
    stageTitle("Random "+g_order+"-Corner tileset - "+cap(g_tset));  // set title
	
  //random corn tiles
    var row,col;
	for (row = 0; row < g_fhigh-1; row+=2) {  // not last row
        for (col = 0; col < g_fwide-1; col+=2) {  // not last col
			
		g_field[col][row] = Math.floor(Math.random()*g_order);
		}
    }
	clearBorder();  // reset any border cells to 0
	setTiles();  // calc midd values and set stage tiles
}


function twin_tiles() {  // order always 2
    
	stageTitle("Random 2-edge Twin tileset - "+cap(g_tset));  // set title
	var row,col,val,dd;
    for (row = 1; row < g_fhigh-1; row+=2) {  // not last row
        for (col = 1; col < g_fwide-1; col+=4) {  // not last col
		
            dd = (row+1)%4;  // 0 or 2
			val = Math.floor(Math.random()*2);
			g_field[col+dd+1][row] = val;  // horiz copy
			g_field[col+dd-1][row] = val;
			val = Math.floor(Math.random()*2);
			g_field[col+dd][row+1] = val;  // vert copy
			g_field[col+dd][row-1] = val;
		}
    }
	clearBorder();  // reset any border cells to 0
	clearBorder2();  // reset 'inner' border cells to 0
	setTiles();  // calc midd values and set stage tiles
}


function blob_tiles() {  //
	clearCells(0);
    if (document.getElementById('sq').checked) {blob_0(); } 
        else {blob_1(); }  // 47 or 48
}

function blob_1() {  // unchecked

	stageTitle("Random - 2-edge 2-corner Blob tileset - "+cap(g_tset));  // set title
  
  // all cells (edge and corner) random '0' or '1'
    var row,col;
	for (row = 1; row < g_fhigh-1; row++) {  // not first or last 'border' rows
        for (col = 1; col < g_fwide-1; col++) {  // not first or last 'border' cols
			
			if (Math.floor(Math.random()*5) !== 0) {g_field[col][row] = 1; }  // set to 1 
		}
    }
    // all central 'odd' cells
	// if edge above or left = 0 set corners to 0

    for (row = 1; row < g_fhigh; row+=2) {
        for (col = 1; col < g_fwide; col+=2) {
			
            if ( g_field[col][row-1]===0 ) { g_field[col-1][row-1] = 0; g_field[col+1][row-1] = 0; }
            if ( g_field[col-1][row]===0 ) { g_field[col-1][row-1] = 0; g_field[col-1][row+1] = 0; }
        }
    }

    removeHoles();  // 'optional', remove corner holes
	setTiles();  // set field cells and stage tiles
}


function blob_0() {  // checked

	stageTitle("Random - 2-edge 2-corner Blob* tileset - "+cap(g_tset));  // set title
  
  //make cell centres random 0 or 1
    var row,col;
    for (row = 1; row < g_fhigh; row+=2) {
        for (col = 1; col < g_fwide; col+=2) {
			
            if (Math.floor(Math.random()*5) !== 0) g_field[col][row] = 1;  // abandon 1 in 5, leave as a 0
        }
    }
	
	//visit corners and check top and left edges
	for (row = 2; row < g_fhigh-2; row+=2) {  // not first or last row
        for (col = 2; col < g_fwide-2; col+=2) {  // not first or last col
			
            if (g_field[col-1][row-1] && g_field[col-1][row+1] ) {g_field[col-1][row] = 1; }  // left
            if (g_field[col-1][row-1] && g_field[col+1][row-1] ) {g_field[col][row-1] = 1; }  // top
		}
    }
	
	//horizontal edges in last column
	for (row = 2; row < g_fhigh-2; row+=2) {  // not first or last row
		col = g_fwide-1;	
		if (g_field[col-1][row-1] && g_field[col-1][row+1] ) {g_field[col-1][row] = 1; }  // left
    }
	//vertical edges in last row
	for (col = 2; col < g_fwide-2; col+=2) {  // not first or last col
		row = g_fhigh-1;	
		if (g_field[col-1][row-1] && g_field[col+1][row-1] ) {g_field[col][row-1] = 1; }  // top
    }
	
	removeHoles();  // remove corner holes	
    setTiles();  // set field cells and stage tiles       
}

function removeHoles() {
  // remove 90% of single corner holes
    var row,col;
    for (row = 2; row < g_fhigh-2; row+=2) {  // not first or last row
        for (col = 2; col < g_fwide-2; col+=2) {  // not first or last col

            if (Math.floor(Math.random()*10) === 0) continue;  // abandon 1 in 10 for variety
            if (g_field[col][row]===0 && g_field[col-1][row] && g_field[col+1][row] && g_field[col][row-1] && g_field[col][row+1] ) g_field[col][row] = 1;
        }
    }
}

function block_value(col,row) {
	// return midd value for block tilesets
    return g_field[col-1][row-1];  // stored data
}

function truch_value(col,row) {
	// return midd value for truchet tilesets
	var parity = (0.5*(col-1)+0.5*(row-1)) % 2;   // 0 or 1
    return g_piece*(parity) + g_field[col-1][row-1];  // stored data
}

function edge_value(col,row) {
	// return midd value for edge tilesets
	return (Math.pow(g_order,3)*g_field[col-1][row]) +
	(Math.pow(g_order,2)*g_field[col][row+1]) +
	(g_order*g_field[col+1][row]) +
	g_field[col][row-1];
}

function corn_value(col,row) {
	// return midd value for corner tilesets
	return (Math.pow(g_order,3)*g_field[col-1][row-1]) +
	(Math.pow(g_order,2)*g_field[col-1][row+1]) +
	(g_order*g_field[col+1][row+1]) +
	g_field[col+1][row-1];
}

function blob_value(col,row) { // order unused, set to 2
	// return midd value for blob tilesets
	return 128*g_field[col-1][row-1] + 64*g_field[col-1][row] +
	32*g_field[col-1][row+1] + 16*g_field[col][row+1] + 8*g_field[col+1][row+1] +
	4*g_field[col+1][row] + 2*g_field[col+1][row-1] + g_field[col][row-1];
}

function twin_value(col,row) { // order set to 2
	// return midd value for twin tilesets
	// treat as 3 order edge tileset, double edge values in 3rd col and rows
	var vert = 1; var horz = 1;
	if (col%4==3) {vert = 2; }
	if (row%4==3) {horz = 2; }

	return (horz*27*g_field[col-1][row]) + (vert*9*g_field[col][row+1]) +
	(horz*3*g_field[col+1][row]) + vert*g_field[col][row-1];
}

function block2_x(val) {
	var x = [0,1,2,3];
	return -32* x[val];
}
function block2_y(val) {
	return 0;
}
function truch2_x(val) {
	var x = [0,1,2,3,4,5,6,7];
	return -32* x[val];
}
function truch2_y(val) {
	return 0;
}
function edge2_x(val) {
	var x = [0,0,1,1,0,0,1,1,3,3,2,2,3,3,2,2];
	return -32* x[val];
}
function edge2_y(val) {
	var y = [3,2,3,2,0,1,0,1,3,2,3,2,0,1,0,1];
	return -32* y[val];
}
function corn2_x(val) {
	var x = [0,0,1,1,0,2,3,1,3,1,0,2,3,3,2,2];
	return -32* x[val];
}
function corn2_y(val) {
	var y = [3,2,3,0,0,3,0,1,3,2,1,2,2,1,0,1];
	return -32* y[val];
}

function edge3_x(val) {
var x = [
	0,0,0,1,1,1,4,4,4,0,
	0,0,1,1,1,4,4,4,0,0,
	0,1,1,1,4,4,4,3,3,3,
	2,2,2,6,6,6,3,3,3,2,
	2,2,6,6,6,3,3,3,2,2,
	2,6,6,6,8,8,8,5,5,5,
	7,7,7,8,8,8,5,5,5,7,
	7,7,8,8,8,5,5,5,7,7,
	7];
	return -32* x[val];
}
function edge3_y(val) {
	var y = [
	8,7,4,8,7,4,8,7,4,5,
	6,2,5,6,2,5,6,2,0,3,
	1,0,3,1,0,3,1,8,7,4,
	8,7,4,8,7,4,5,6,2,5,
	6,2,5,6,2,0,3,1,0,3,
	1,0,3,1,8,7,4,8,7,4,
	8,7,4,5,6,2,5,6,2,5,
	6,2,0,3,1,0,3,1,0,3,
	1];
	return -32* y[val];
}
function corn3_x(val) {
var x = [
	4,3,6,7,2,1,5,8,0,1,
	0,3,4,8,7,2,5,6,3,2,
	5,6,1,0,4,7,8,5,4,7,
	8,3,2,6,0,1,6,5,8,0,
	4,3,7,1,2,0,8,2,3,7,
	6,1,4,5,2,1,4,5,0,8,
	3,6,7,7,6,0,1,5,4,8,
	2,3,8,7,1,2,6,5,0,3,
	4];
	return -32* x[val];
}
function corn3_y(val) {
	var y = [
	8,7,7,5,5,2,8,2,7,5,
	1,1,2,5,8,8,2,1,8,6,
	0,8,3,8,0,6,3,7,7,4,
	1,6,4,6,6,1,5,6,0,5,
	6,5,3,0,3,2,6,0,2,0,
	2,6,3,3,7,4,1,1,0,4,
	0,0,7,2,4,4,8,5,5,8,
	2,4,7,1,7,1,3,4,3,3,
	4];
	return -32* y[val];
}
function blob2_x(val) {
	var x = {
		0:0, 4:1, 92:2, 124:3, 116:4, 80:5,
		16:0, 20:1, 87:2, 223:3, 241:4, 21:5, 64:6,
		29:0, 117:1, 85:2, 71:3, 221:4, 125:5, 112:6,
		31:0, 253:1, 113:2, 28:3, 127:4, 247:5, 209:6,
		23:0, 199:1, 213:2, 95:3, 255:4, 245:5, 81:6,
		5:0, 84:1, 93:2, 119:3, 215:4, 193:5, 17:6,
		      1:1, 7:2, 197:3, 69:4, 68:5, 65:6};
		return -32* x[val];
}
function blob2_y(val) {
	var y = {
		0:0, 4:0, 92:0, 124:0, 116:0, 80:0,
		16:1, 20:1, 87:1, 223:1, 241:1, 21:1, 64:1,
		29:2, 117:2, 85:2, 71:2, 221:2, 125:2, 112:2,
		31:3, 253:3, 113:3, 28:3, 127:3, 247:3, 209:3,
		23:4, 199:4, 213:4, 95:4, 255:4, 245:4, 81:4,
		5:5, 84:5, 93:5, 119:5, 215:5, 193:5, 17:5,
		      1:6, 7:6, 197:6, 69:6, 68:6, 65:6};
		return -32* y[val];
}
function twin2_x(val) {
	var x = {
		12:0, 39:1, 36:2, 18:3, 9:4,
		13:0, 28:1, 10:2, 26:3,      54:5,
		4:0, 30:1, 40:2,        31:4, 27:5,
		6:0, 78:1, 70:2, 80:3, 60:4, 72:5,
		3:0, 50:1, 37:2, 20:3, 24:4, 74:5,
		0:0, 2:1, 1:2, 8:3, 62:4, 56:5};
		return -32* x[val];
}
function twin2_y(val) {
	var y = {
		12:0, 39:0, 36:0, 18:0, 9:0,
		13:1, 28:1, 10:1, 26:1,      54:1,
		4:2, 30:2, 40:2,        31:2, 27:2,
		6:3, 78:3, 70:3, 80:3, 60:3, 72:3,
		3:4, 50:4, 37:4, 20:4, 24:4, 74:4,
		0:5, 2:5, 1:5, 8:5, 62:5, 56:5};
		return -32* y[val];
}

/////////////////////

function setTiles() {  // see 'putcell' for single cell/tile
	// calc midd cells and set stage tiles
	
	var func = g_type + "_value";  // function 'g_type'
	var funcx = g_type + g_order + "_x";
	var funcy = g_type + g_order + "_y";
	var imgpath = "../art/atlas/" + g_type + "/" + g_tset + ".png";
	var row,col,cell,val;
	for (row = 1; row < g_fhigh; row+=2) {
		for (col = 1; col < g_fwide; col+=2) {
			val = window[func](col,row);  // calc tile index
			g_field[col][row] = val;    // update midd cell
			cell = document.getElementById(cellname(col,row));
			//cell.style.backgroundColor = "rgb(64,0,0)";
			cell.style.backgroundImage = "url('" + imgpath + "')";
			cell.style.backgroundPosition = window[funcx](val) + 'px ' + window[funcy](val) + 'px';
		}
	}
}

function setTileset() {  // see 'settileImg' for individual tiles
	// update tileset without recalculating tile indexes
	var imgpath = "../art/atlas/" + g_type + "/" + g_tset + ".png";
	var row,col;
	for (row = 1; row < g_fhigh; row+=2) {
		for (col = 1; col < g_fwide; col+=2) {
			cell = document.getElementById(cellname(col,row));
			cell.style.backgroundImage = "url('" + imgpath + "')";  // update tile img
		}
	}
}

function setTileset_() {
	// update tile offsets, due to possible brench alt
	var funcx = g_type + g_order + "_x";
	var funcy = g_type + g_order + "_y";
	//var imgpath = "../art/atlas/" + g_type + "/" + g_tset + ".png";
	var row,col,val;
	for (row = 1; row < g_fhigh; row+=2) {
		for (col = 1; col < g_fwide; col+=2) {
			val = g_field[col][row];  // tile index
			cell = document.getElementById(cellname(col,row));
			//cell.style.backgroundImage = "url('" + imgpath + "')";  // update tile img
			// reset offsets for Twin tilesets only
			cell.style.backgroundPosition = window[funcx](val) + 'px ' + window[funcy](val) + 'px';
		}
	}
}

/////////////////////

function brench_alt() { // add alternative tiles to twin brench stage
	document.getElementById('ba').checked = 0;  // brench_alt

	/*if (g_tset != "brench") { 
		alert("Alternative tiles added to Brench array only");
		return;
	}*/
	
	setTileset_();  //remove any previous alt tiles
	
	var row,col,dd,val,nort,east,sout,west;
	// 'sw' path tiles
	for (row = 3; row < g_fhigh-1; row+=4) {  // not last row
		for (col = 1; col < g_fwide-1; col+=4) {  // not last col
			
			if (g_field[col][row] == 0) { // alt 0 link tiles
				nort = g_field[col][row-2];
				east = g_field[col+2][row];
				if ( (nort==3 || nort==4 || nort==27 || nort==31) && (east==2 || east==8 || east==18 || east==24 || east==26) ) {
					puttileImg(col,row,1,6);    // update tile img
				}
				else if ( (nort==3 || nort==4 || nort==27 || nort==31) ) {
					puttileImg(col,row,2,6);    // update tile img
				}
				else if ( (east==2 || east==8 || east==18 || east==24 || east==26) ) {
					puttileImg(col,row,3,6);    // update tile img
				}
			}
			if (g_field[col][row-2] == 10) {puttileImg(col,row-2,1,7); } // alt straight tiles
			if (g_field[col][row-2] == 30) {puttileImg(col,row-2,0,7); } // alt straight tiles
			//if (row%8 + col%8 == 8) {  // weave along alt diagonals
				//if (g_field[col][row] == 70) {puttileImg(col,row,"70x"); }
			//}		
		}
	}
	// 'ne' path tiles
	for (row = 1; row < g_fhigh-1; row+=4) {  // not last row
		for (col = 3; col < g_fwide-1; col+=4) {  // not last col
		
			if (g_field[col][row] == 0) {  // alt 0 link tiles
				sout = g_field[col][row+2];
				west = g_field[col-2][row];
				if ( (sout==6 || sout==54 || sout==72 || sout==78) && (west==1 || west==9 || west==28 || west==36 || west==37) ) {
					puttileImg(col,row,0,6);    // update tile img
				}
				else if ( (sout==6 || sout==54 || sout==72 || sout==78) ) {
					puttileImg(col,row,4,6);    // update tile img
				}
				else if ( (west==1 || west==9 || west==28 || west==36 || west==37) ) {
					puttileImg(col,row,5,6);    // update tile img
				}
			}
			if (g_field[col][row+2] == 20) {puttileImg(col,row+2,3,7); } // alt straight tiles
			if (g_field[col][row+2] == 60) {puttileImg(col,row+2,2,7); } // alt straight tiles
			//if (row%8 + col%8 == 8) {  // weave along alt diagonals
				//if (g_field[col][row] == 50) {puttileImg(col,row,"50x"); }
			//}
		}
	}
}
