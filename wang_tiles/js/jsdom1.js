// JavaScript Document
//alert(JSON.stringify(imgpath))
// declare globals
// code on this page is dependent on stage creation method

var g_type = "truch";  // global value
var g_tset = "none";  // global value
var g_curx = 0;  // cursor x position
var g_cury = 0;
var g_piece = 1;  // Truchet & Block tileset size
var g_47 = 0;  // Blob 0=edge, 1=corn
var g_order = 2;  // tileset order, either 2 or 3
var g_roll = 0;  // rollover not active
var g_move = 1;  // movement
var g_clear = 0;
var g_draw = 3;  // ie +1
//var g_bal = 7;  // fixed for Blob and Blob*
var g_auto = null;  // auto sprinkle (and maze) timing info
var g_path0 = [];  // maze visited cells
var g_path1 = [];  // twin maze visited cells
var g_rand = 0;  // random : last ratio

var g_wide = 18;  // stage width
var g_high = 12;  // stage height

var g_field = [];  // field of data values
var g_fwide = 2*g_wide+1;    // field width
var g_fhigh = 2*g_high+1;    // field height

function init() {  // on page load
	newField();  // create new field
	newStage();  // create new stage
	cursors();  // reset cursors and 'cr31'
	resetAll();  // reset all menus
	truch_tiles();  // random Truchet tiles to fill 'empty' stage
}
  
function cursors() {  // reset cursors and 'cr31'
  var cr31 = document.getElementById("cr31");
  cr31.style.top = 32*(g_high-1) + "px";
  cr31.style.left = 32*(g_wide-1) + "px";
  
  var over = document.getElementById("over");
  over.style.top = -32 + "px";
  over.style.left = 16 + "px";
  var down = document.getElementById("down");
  down.style.top = -32 + "px";
  down.style.left = 16 + "px";
}

function newField() {  // create new 'field' of 'cells'
	g_field = [];  // global value !!
    for (var col = 0; col < g_fwide; col++) {
        g_field[col] = [];
        for (var row = 0; row < g_fhigh; row++) {
            g_field[col][row] = 0;  // set all to 0
		}
    }
}

function newStage() {  // create new 'stage' of 'tiles'
	var handler = function() {cursor(this.id); };

	// get the reference for the stagearea
	var stagearea = document.getElementById("stagearea");
  
	// creates a <table> element
	var tbl = document.createElement("table");
	tbl.setAttribute('id', "stage");
	tbl.setAttribute('class', "bevel");
  
  // create rows, stage tiles only at odd field cells !!
  for (var row = 1; row < g_fhigh; row+=2) {
    var h_row = document.createElement("tr");  // creates a table row
    // create cells in row
    for (var col = 1; col < g_fwide; col+=2) {
      var cell = document.createElement("td");
      cell.setAttribute('id', cellname(col,row));
	  cell.onmouseover = handler; 
      h_row.appendChild(cell);  // add cell to the end of the row
    }
    tbl.appendChild(h_row);  // add row to the end of the table
  }
  stagearea.appendChild(tbl);  // appends <table> into <stagearea>
}

function stageSize(size) {  // resize stage
  // delete old stage
  var stagearea = document.getElementById("stagearea");
  var stage = document.getElementById("stage");
  stagearea.removeChild(stage);
  
  g_wide = parseInt(size.substring(0, 2) );  // stage width 
  g_high = parseInt(size.substring(3, 5) );  // stage height
  g_fwide = 2*g_wide+1;  // field width
  g_fhigh = 2*g_high+1;  // field height

	newField();  // create new field
	newStage();  // create new stage
	cursors();  // reset cursors and 'cr31'
	rand();  // random tiles to fill 'new' stage
}
	
function cap(string) {  // capitalise initial letter, and put in quotes
	return "'" + string.charAt(0).toUpperCase() + string.slice(1) + "'";
}

function rlw(str) {  // remove last word
	var lastIndex = str.lastIndexOf(" ");
	return str.substring(0, lastIndex);
}

function resetAll() {  // reset all menus
  document.getElementById('ssize').options[0].selected = 1;
  document.getElementById('truch').options[0].selected = 1;
  document.getElementById('bloc2').options[0].selected = 1;
  document.getElementById('bloc4').options[0].selected = 1;
  document.getElementById('paths2').options[0].selected = 1;
  document.getElementById('paths3').options[0].selected = 1;
  document.getElementById('patch2').options[0].selected = 1;
  document.getElementById('patch3').options[0].selected = 1;
  document.getElementById('blob').options[0].selected = 1;
  document.getElementById('twin').options[0].selected = 1;
  document.getElementById('rand').options[1].selected = 1;  // 10%
  
  document.getElementById('rg0').checked = 0;
  document.getElementById('rg1').checked = 0;
  document.getElementById('rg2').checked = 0;
  document.getElementById('rg3').checked = 1;
  
  document.getElementById('tq').checked = 0;  // block2
  document.getElementById('sq').checked = 0;  // blob2
  document.getElementById('ba').checked = 0;  // brench_alt
  
  document.getElementById('bevel').checked = 0;
  var elem  = document.getElementById("stage");
  //elem.setAttribute('class');  // remove bevel
  elem.removeAttribute('class');  // remove bevel
}

function showhide(id) {  // toggle show/hide instructions text block
	var e = document.getElementById(id);
		if (e.style.display == 'block')
			e.style.display = 'none';
		else
			e.style.display = 'block';
}
