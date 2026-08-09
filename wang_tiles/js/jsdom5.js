// JavaScript Document ... Maze

function maze() {  // maze button, init maze
	if (g_tset == "none" || g_type == "block" || g_type == "truch" ) {
		alert ("Select an Edge, Corner, Blob or Twin tileset"); return; }
	if (g_auto) stop_auto();  // stop auto if running, freeze maze
	
	stageTitle("Maze ("+g_rand+"%) "+g_order+"-"+g_type+" tileset - "+cap(g_tset));  // set title
	clearCells(0);
	setTiles();  // set midd field cells and stage tiles
	
	if (g_draw === 0 || g_draw == 3) {g_draw = 1;  setrbs(); }  // set g_draw to 1, else maze can be invisible
	//if (g_draw == 3) g_draw = 1;  // we'll invert 1-2 each new branch (3-val) % 3
	
	// random stage tile 'here'
	var randx,randy,here;
	if (g_type == "twin") {
		randx = 5 + 4* Math.floor(Math.random()*((g_wide-2)/2));
		randy = 5 + 4* Math.floor(Math.random()*((g_high-2)/2));
		here = [randx, randy];  // random tile
		g_path0 = [here];  // list within list
		randx = 7 + 4* Math.floor(Math.random()*((g_wide-2)/2));
		randy = 7 + 4* Math.floor(Math.random()*((g_high-2)/2));
		here = [randx, randy];  // random tile
		g_path1 = [here];  // list within list
		var wait = 150;  // wait time
	} else {
		randx = 1 + 2* Math.floor(Math.random()*g_wide);
		randy = 1 + 2* Math.floor(Math.random()*g_high);
		here = [randx, randy];  // random tile
		g_path0 = [here];  // list within list
		var wait = 50;  // wait time
	}
	
	var auto = document.getElementById("auto");
	auto.style.borderColor='#ff0000';  // red button border
	var func = "automaze_" + g_type;  // edge, corn, blob, twin,  function automaze 'g_type'
	g_auto = setInterval(function(){window[func]()},wait);
}

function automaze_edge() {
	if (g_path0.length === 0) {stop_auto(); return; }  // all done
	
	if (Math.floor(Math.random()*100) < g_rand) {
		var ind = Math.floor(Math.random()*g_path0.length);  // random tile in list
	} else {
		var ind = g_path0.length-1;  // last tile in list
	}
		
	var col = g_path0[ind][0];
	var row = g_path0[ind][1];
	
	var bors = [];  // neighbors
	if (row>2 && g_field[col][row-2] === 0 ) {bors.push([0,-1]); }
	if (col<g_fwide-3 && g_field[col+2][row] === 0 ) {bors.push([1,0]); }
	if (row<g_fhigh-3 && g_field[col][row+2] === 0 ) {bors.push([0,1]); }
	if (col>2 && g_field[col-2][row] === 0 ) {bors.push([-1,0]); }
	
	//if (bors.length == 1 || bors.length == 2 || (bors.length == 3 && g_path0.length == 2) || (bors.length == 4 && g_path0.length == 1) ) { 
	if (bors.length > 0) { 
		var next = bors[Math.floor(Math.random()*bors.length)];  // pick random neighbour
		var dx = next[0];
		var dy = next[1];
		
		set_edge(col,row,dx,dy);
		g_path0.push([col+2*dx,row+2*dy]);  // add to list
	} else {  // no neighbors
		g_path0.splice(ind, 1);	// remove item at position 'ind' from array
		automaze_edge();  // animate something ... tail recursion?
	}
}

function automaze_corn() {
	if (g_path0.length === 0) {stop_auto(); return; }  // all done
	
	if (Math.floor(Math.random()*100) < g_rand) {
		var ind = Math.floor(Math.random()*g_path0.length);  // random tile in list
	} else {
		var ind = g_path0.length-1;  // last tile in list
	}
		
	var col = g_path0[ind][0];
	var row = g_path0[ind][1];
	
	var bors = [];  // neighbors
	if (col<g_fwide-3 && row>2 && g_field[col+2][row-2] === 0 ) {bors.push([1,-1]); }
	if (col<g_fwide-3 && row<g_fhigh-3 && g_field[col+2][row+2] === 0 ) {bors.push([1,1]); }
	if (col>2 && row<g_fhigh-3 && g_field[col-2][row+2] === 0 ) {bors.push([-1,1]); }
	if (col>2 && row>2 && g_field[col-2][row-2] === 0 ) {bors.push([-1,-1]); }
	
	if (bors.length > 0) {  //alert(bors.join('\n'));
		var next = bors[Math.floor(Math.random()*bors.length)];  // pick random neighbour
		var dx = next[0];
		var dy = next[1];
		
		set_corn(col,row,dx,dy);
		g_path0.push([col+2*dx,row+2*dy]);  // add to list
	} else {  // no neighbors
		g_path0.splice(ind, 1);	// remove item at position 'ind' from array
		automaze_corn();  // animate something ... tail recursion?
	}
}

function automaze_twin() {
	if ((g_path0.length === 0) && (g_path1.length === 0)) {
		stop_auto();
		if (g_tset !== "wang") { twin_alt(); }  // add in alt tiles
		return; }  // all done
	automaze_twin0();
	automaze_twin1();
}

function automaze_twin0() {
	if (g_path0.length === 0) {return; }  // done
	
	if (Math.floor(Math.random()*100) < g_rand) {
		var ind = Math.floor(Math.random()*g_path0.length);  // random tile in list
	} else {
		var ind = g_path0.length-1;  // last tile in list
	}
		
	var col = g_path0[ind][0];
	var row = g_path0[ind][1];
	
	var bors = [];  // neighbors
	if (row>4 && g_field[col][row-4] === 0 ) {bors.push([0,-1]); }
	if (col<g_fwide-5 && g_field[col+4][row] === 0 ) {bors.push([1,0]); }
	if (row<g_fhigh-5 && g_field[col][row+4] === 0 ) {bors.push([0,1]); }
	if (col>4 && g_field[col-4][row] === 0 ) {bors.push([-1,0]); }
		
	if (bors.length > 0) {
		next = bors[Math.floor(Math.random()*bors.length)];  // pick random neighbour
		dx = next[0];
		dy = next[1];
			
		set_twin(col,row,dx,dy);
		g_path0.push([col+4*dx,row+4*dy]);
	} else {  // no neighbors
		g_path0.splice(ind, 1);	// remove item at position 'ind' from array
		automaze_twin0();  // animate something ... tail recursion?
	}
}
	
function automaze_twin1() {
	if (g_path1.length === 0) {return; }  // done
	
	if (Math.floor(Math.random()*100) < g_rand) {
		var ind = Math.floor(Math.random()*g_path1.length);  // random tile in list
	} else {
		var ind = g_path1.length-1;  // last tile in list
	}
		
	var col = g_path1[ind][0];
	var row = g_path1[ind][1];
	
	var bors = [];  // neighbors
	if (row>4 && g_field[col][row-4] === 0 ) {bors.push([0,-1]); }
	if (col<g_fwide-5 && g_field[col+4][row] === 0 ) {bors.push([1,0]); }
	if (row<g_fhigh-5 && g_field[col][row+4] === 0 ) {bors.push([0,1]); }
	if (col>4 && g_field[col-4][row] === 0 ) {bors.push([-1,0]); }
		
	if (bors.length > 0) {
		next = bors[Math.floor(Math.random()*bors.length)];  // pick random neighbour
		dx = next[0];
		dy = next[1];
			
		set_twin(col,row,dx,dy);
		g_path1.push([col+4*dx,row+4*dy]);
	} else {  // no neighbors
		g_path1.splice(ind, 1);	// remove item at position 'ind' from array
		automaze_twin1();  // animate something ... tail recursion?
	}
}

function automaze_blob() {
	if (g_path0.length === 0) {stop_auto(); return; }  // all done
	
	if (Math.floor(Math.random()*100) < g_rand) {
		var ind = Math.floor(Math.random()*g_path0.length);  // random tile in list
	} else {
		var ind = g_path0.length-1;  // last tile in list
	}
		
	var col = g_path0[ind][0];
	var row = g_path0[ind][1];
	
	var bors = [];  // neighbors
	if (row>2 && g_field[col][row-2] === 0 ) {bors.push([0,-1]); }
	if (col<g_fwide-3 && g_field[col+2][row] === 0 ) {bors.push([1,0]); }
	if (row<g_fhigh-3 && g_field[col][row+2] === 0 ) {bors.push([0,1]); }
	if (col>2 && g_field[col-2][row] === 0 ) {bors.push([-1,0]); }
	
	if (bors.length > 0) {
		var next = bors[Math.floor(Math.random()*bors.length)];  // pick random neighbour
		var dx = next[0];
		var dy = next[1];
		
		set_blob_edge(col,row,dx,dy);
		
		var cnt,dxx,dyy;
		// add up the 3 possible edges to the left
		var cnt = 0;
		if (g_field[col+dy][row-dx] == 1) {cnt+=1; }
		if (fieldd([col+dx+2*dy],[row-2*dx+dy]) == 1) {cnt+=1; }
		if (fieldd([col+2*dx+dy],[row-dx+2*dy]) == 1) {cnt+=1; } 
		if (cnt == 2) {  // then 3 edges
			if (dx === 0) {dxx =  dy; } else { dxx =  dx; }
			if (dy === 0) {dyy = -dx; } else { dyy =  dy; }
			set_blob_corn(col,row,dxx,dyy);
		}
		// add up the 3 possible edges to the rite
		var cnt = 0;
		if (g_field[col-dy][row+dx] == 1) {cnt+=1; }
		if (fieldd([col+dx-2*dy],[row+2*dx+dy]) == 1) {cnt+=1; }
		if (fieldd([col+2*dx-dy],[row+dx+2*dy]) == 1) {cnt+=1; } 
		if (cnt == 2) {  // then 3 edges
			if (dx === 0) {dxx = -dy; } else { dxx =  dx; }
			if (dy === 0) {dyy =  dx; } else { dyy =  dy; }
			set_blob_corn(col,row,dxx,dyy);
		}
			
		g_path0.push([col+2*dx,row+2*dy]);  // add to list
	} else {  // no neighbors
		g_path0.splice(ind, 1);	// remove item at position 'ind' from array
		automaze_blob();  // animate something ... tail recursion?
	}
}

function fieldd(col,row) {
	// may be outside field ... return value at col row
	var col = col % g_fwide;
	var row = row % g_fhigh;
	return g_field[col][row];
}