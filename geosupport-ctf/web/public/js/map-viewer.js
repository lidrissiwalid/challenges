// Map Viewer — powered by Leaflet + OpenStreetMap

document.addEventListener('DOMContentLoaded', function () {

  // Fix marker icon paths (leaflet.css is at /css/, images at /images/)
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl:       '/images/marker-icon.png',
    iconRetinaUrl: '/images/marker-icon-2x.png',
    shadowUrl:     '/images/marker-shadow.png',
  });

  // ── Basemap tile layers ─────────────────────────────────────────────────────
  var basemaps = {
    streets: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
    }),
    satellite: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: '&copy; Esri &mdash; Source: Esri, USGS, NOAA',
    }),
    terrain: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
    }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
    }),
  };

  // ── GeoJSON overlay factories ───────────────────────────────────────────────
  var layerDefs = {
    roads: function () {
      return L.geoJSON({
        type: 'FeatureCollection', features: [
          { type:'Feature', geometry:{ type:'LineString', coordinates:[[2.30,48.87],[2.35,48.86],[2.40,48.85]] }, properties:{ name:'Route A1' } },
          { type:'Feature', geometry:{ type:'LineString', coordinates:[[2.32,48.90],[2.33,48.86],[2.34,48.82]] }, properties:{ name:'Route N2' } },
          { type:'Feature', geometry:{ type:'LineString', coordinates:[[2.25,48.84],[2.38,48.84]] }, properties:{ name:'Boulevard Est' } },
        ]
      }, { style: { color:'#1a56db', weight:3, opacity:0.75 } });
    },
    landuse: function () {
      return L.geoJSON({
        type: 'FeatureCollection', features: [
          { type:'Feature', geometry:{ type:'Polygon', coordinates:[[[2.30,48.88],[2.36,48.88],[2.36,48.84],[2.30,48.84],[2.30,48.88]]] }, properties:{ use:'Urban' } },
          { type:'Feature', geometry:{ type:'Polygon', coordinates:[[[2.37,48.87],[2.43,48.87],[2.43,48.83],[2.37,48.83],[2.37,48.87]]] }, properties:{ use:'Agriculture' } },
        ]
      }, { style: { color:'#16a34a', weight:1.5, fillOpacity:0.18, opacity:0.7 } });
    },
    hydro: function () {
      return L.geoJSON({
        type: 'FeatureCollection', features: [
          { type:'Feature', geometry:{ type:'LineString', coordinates:[[2.28,48.91],[2.31,48.87],[2.33,48.83],[2.35,48.80]] }, properties:{ name:'Rivière Nord' } },
          { type:'Feature', geometry:{ type:'LineString', coordinates:[[2.38,48.89],[2.36,48.85]] }, properties:{ name:'Canal Sud' } },
        ]
      }, { style: { color:'#0ea5e9', weight:2.5, opacity:0.85 } });
    },
    dem: function () {
      return L.geoJSON({
        type: 'FeatureCollection', features: [
          { type:'Feature', geometry:{ type:'Polygon', coordinates:[[[2.26,48.92],[2.32,48.92],[2.32,48.88],[2.26,48.88],[2.26,48.92]]] }, properties:{ elev:'200-250m' } },
          { type:'Feature', geometry:{ type:'Polygon', coordinates:[[[2.40,48.82],[2.46,48.82],[2.46,48.78],[2.40,48.78],[2.40,48.82]]] }, properties:{ elev:'50-100m' } },
        ]
      }, { style: { color:'#f59e0b', weight:1, fillOpacity:0.22, opacity:0.6 } });
    },
    admin: function () {
      return L.geoJSON({
        type: 'FeatureCollection', features: [
          { type:'Feature', geometry:{ type:'Polygon', coordinates:[[[2.24,48.93],[2.45,48.93],[2.45,48.78],[2.24,48.78],[2.24,48.93]]] }, properties:{ name:'Région Île-de-France' } },
        ]
      }, { style: { color:'#8b5cf6', weight:2, fillOpacity:0.05, dashArray:'6 4', opacity:0.8 } });
    },
  };

  // ── Initialise map ──────────────────────────────────────────────────────────
  var map = L.map('mapContainer', {
    center: [48.8566, 2.3522],
    zoom: 11,
    zoomControl: true,
  });

  basemaps.streets.addTo(map);

  // ── Default overlays ────────────────────────────────────────────────────────
  var activeOverlays = {};
  ['roads', 'landuse', 'hydro'].forEach(function (id) {
    activeOverlays[id] = layerDefs[id]();
    activeOverlays[id].addTo(map);
  });

  // Force Leaflet to recalculate container size after the page finishes rendering
  setTimeout(function () { map.invalidateSize(); }, 200);

  // ── Coordinate display ──────────────────────────────────────────────────────
  map.on('mousemove', function (e) {
    document.getElementById('coordLat').textContent = e.latlng.lat.toFixed(5);
    document.getElementById('coordLon').textContent = e.latlng.lng.toFixed(5);
  });
  map.on('zoomend', function () {
    document.getElementById('zoomLevel').textContent = String(map.getZoom());
  });

  // ── Layer toggles ───────────────────────────────────────────────────────────
  document.querySelectorAll('.toggle').forEach(function (toggle) {
    var id = toggle.dataset.layer;
    toggle.addEventListener('click', function () {
      this.classList.toggle('off');
      if (this.classList.contains('off')) {
        if (activeOverlays[id]) {
          map.removeLayer(activeOverlays[id]);
          delete activeOverlays[id];
        }
      } else {
        if (layerDefs[id]) {
          activeOverlays[id] = layerDefs[id]();
          activeOverlays[id].addTo(map);
        }
      }
    });
  });

  // ── Basemap switcher ────────────────────────────────────────────────────────
  document.getElementById('basemapSelect').addEventListener('change', function () {
    Object.values(basemaps).forEach(function (l) { map.removeLayer(l); });
    var selected = basemaps[this.value];
    if (selected) {
      selected.addTo(map);
      selected.bringToBack();
    }
  });

});
