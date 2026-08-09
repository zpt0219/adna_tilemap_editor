// JavaScript Document

window.onload = function() {  // menu hilight 
	/*var menuarea = document.getElementById("menu");*/
	//var loc = document.URL.replace(/[0-9]\./, '.');  // (/#.*$/, "") remove hashtag anchors
	//alert(loc);
	var loc = document.URL;
	for (var i = 0; i < document.links.length; i++) {
		if (document.links[i].href == loc ) {
			document.links[i].style.background = '#cdd9eb';
			return;
		}
	}
}
