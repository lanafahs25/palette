(function(){
  "use strict";

  /* ================= SET THESE TWO VALUES =================
     Find them in Supabase → Project Settings → API
  ============================================================ */
  var SUPABASE_URL = 'https://kdqkvnaoingalaawifvr.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_3EsT3bY-YD6pWOH0KP4x2g_Lur8urh-';
  /* =========================================================== */

  /* ---------------- pigment library ---------------- */
  var PIGMENTS = [
    {id:'twhite', name:'Titanium White',        hex:'#F7F4EC'},
    {id:'mblack', name:'Mars Black',             hex:'#201D1B'},
    {id:'cyl',    name:'Cadmium Yellow Light',   hex:'#FFE711'},
    {id:'cym',    name:'Cadmium Yellow Medium',  hex:'#FFB60B'},
    {id:'crm',    name:'Cadmium Red Medium',     hex:'#E1291B'},
    {id:'aliz',   name:'Alizarin Crimson',       hex:'#7E1F2E'},
    {id:'ultra',  name:'Ultramarine Blue',       hex:'#1B2A83'},
    {id:'phblue', name:'Phthalo Blue',           hex:'#0A3161'},
    {id:'phgrn',  name:'Phthalo Green',          hex:'#0B3D2E'},
    {id:'bsien',  name:'Burnt Sienna',           hex:'#8A3B24'},
    {id:'bumb',   name:'Burnt Umber',            hex:'#4A2E20'},
    {id:'ochre',  name:'Yellow Ochre',           hex:'#C8922E'},
    {id:'diox',   name:'Dioxazine Purple',       hex:'#3B1F5E'}
  ];

  function hexToRgb(hex){
    var h = hex.replace('#','');
    return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)];
  }
  function rgbToHex(r,g,b){
    function c(v){ v=Math.max(0,Math.min(255,Math.round(v))); var s=v.toString(16); return s.length===1?'0'+s:s; }
    return '#'+c(r)+c(g)+c(b);
  }
  PIGMENTS.forEach(function(p){ p.rgb = hexToRgb(p.hex); });

  /* ---------------- supabase client + auth ---------------- */
  var sb = null;
  var currentUser = null;
  var booted = false;

  function configLooksReal(){
    return SUPABASE_URL && SUPABASE_ANON_KEY &&
      SUPABASE_URL.indexOf('YOUR_') !== 0 && SUPABASE_ANON_KEY.indexOf('YOUR_') !== 0;
  }
  if(configLooksReal() && window.supabase){
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  document.getElementById('googleLoginBtn').addEventListener('click', function(){
    if(!sb){ document.getElementById('configWarning').classList.remove('hidden'); return; }
    sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/palette/' }
    });
  });
  document.getElementById('signOutBtn').addEventListener('click', function(){
    if(sb) sb.auth.signOut();
  });

  function showLoggedOut(){
    currentUser = null;
    booted = false;
    document.getElementById('app').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
  }

  function showLoggedIn(user){
    currentUser = user;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('userEmail').textContent = user.email || '';
    if(!booted){
      booted = true;
      bootData();
    }
  }

  function initAuth(){
    if(!sb){
      document.getElementById('configWarning').classList.remove('hidden');
      return;
    }
    sb.auth.getSession().then(function(res){
      var session = res && res.data && res.data.session;
      if(session && session.user){ showLoggedIn(session.user); } else { showLoggedOut(); }
    });
    sb.auth.onAuthStateChange(function(event, session){
      if(session && session.user){ showLoggedIn(session.user); } else { showLoggedOut(); }
    });
  }

  /* ---------------- remote data helpers ---------------- */
  function fetchAllPalettes(){
    return sb.from('palettes')
      .select('id,name,created_at,reference_image_path,reference_image_hash,reference_image_width,reference_image_height,colors(id,name,hex,mix,match,point_x,point_y,created_at)')
      .order('created_at', {ascending:true})
      .then(function(res){
        if(res.error){ console.error(res.error); showToast('Could not load your palettes'); return []; }
        return Promise.all(res.data.map(function(p){
          var colors = (p.colors||[]).slice().sort(function(a,b){
            return new Date(a.created_at) - new Date(b.created_at);
          });
          var pal = {
            id: p.id, name: p.name, createdAt: new Date(p.created_at).getTime(),
            referenceImagePath:p.reference_image_path||null,
            referenceImageHash:p.reference_image_hash||null,
            referenceImageWidth:p.reference_image_width||null,
            referenceImageHeight:p.reference_image_height||null,
            referenceImageUrl:null,
            colors: colors.map(function(c){
              return {id:c.id, name:c.name, hex:c.hex, mix:c.mix, match:c.match, pointX:c.point_x, pointY:c.point_y, createdAt:new Date(c.created_at).getTime()};
            })
          };
          if(!pal.referenceImagePath) return pal;
          return sb.storage.from('palette-images').createSignedUrl(pal.referenceImagePath, 3600).then(function(imgRes){
            if(!imgRes.error && imgRes.data) pal.referenceImageUrl=imgRes.data.signedUrl;
            return pal;
          });
        }));
      });
  }
  function fetchOwnedPaints(){
    return sb.from('user_settings').select('owned_paints').eq('user_id', currentUser.id).maybeSingle()
      .then(function(res){
        if(res.error){ console.error(res.error); return null; }
        return res.data ? res.data.owned_paints : null;
      });
  }
  function createPaletteRemote(name){
    return sb.from('palettes').insert({name:name, user_id:currentUser.id}).select().single()
      .then(function(res){
        if(res.error){ console.error(res.error); showToast('Could not create palette'); return null; }
        return {id:res.data.id, name:res.data.name, createdAt:new Date(res.data.created_at).getTime(), referenceImagePath:null, referenceImageHash:null, referenceImageWidth:null, referenceImageHeight:null, referenceImageUrl:null, colors:[]};
      });
  }
  function addColorRemote(paletteId, color){
    return sb.from('colors').insert({
      palette_id: paletteId, name: color.name, hex: color.hex, mix: color.mix, match: color.match,
      point_x:color.pointX, point_y:color.pointY
    }).select().single().then(function(res){
      if(res.error){ console.error(res.error); showToast('Could not save color'); return null; }
      var c = res.data;
      return {id:c.id, name:c.name, hex:c.hex, mix:c.mix, match:c.match, pointX:c.point_x, pointY:c.point_y, createdAt:new Date(c.created_at).getTime()};
    });
  }
  function attachImageToPalette(pal){
    if(!currentImage) return Promise.resolve(false);
    if(pal.referenceImageHash){
      if(pal.referenceImageHash===currentImage.hash) return Promise.resolve(true);
      paletteSelect.value='__new__';
      newPaletteRow.classList.remove('hidden');
      newPaletteInput.focus();
      showToast('That palette uses another photo. Create a new palette for this image.');
      return Promise.resolve(false);
    }
    var safeExt=(currentImage.file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    var path=currentUser.id+'/'+pal.id+'/'+currentImage.hash+'.'+safeExt;
    return sb.storage.from('palette-images').upload(path,currentImage.file,{cacheControl:'3600',upsert:false,contentType:currentImage.file.type})
      .then(function(uploadRes){
        if(uploadRes.error && uploadRes.error.message.indexOf('already exists')<0){console.error(uploadRes.error);showToast('Could not save the reference photo');return false;}
        return sb.from('palettes').update({reference_image_path:path,reference_image_hash:currentImage.hash,reference_image_width:currentImage.width,reference_image_height:currentImage.height}).eq('id',pal.id).then(function(updateRes){
          if(updateRes.error){console.error(updateRes.error);showToast('Could not connect the photo to this palette');return false;}
          pal.referenceImagePath=path;pal.referenceImageHash=currentImage.hash;pal.referenceImageWidth=currentImage.width;pal.referenceImageHeight=currentImage.height;pal.referenceImageUrl=currentImage.dataUrl;
          return true;
        });
      });
  }
  function renamePaletteRemote(id, name){
    return sb.from('palettes').update({name:name}).eq('id', id).then(function(res){
      if(res.error){
        console.error(res.error);
        showToast('Could not rename palette');
        return false;
      }
      return true;
    });
  }
  function deletePaletteRemote(id,imagePath){
    return sb.from('palettes').delete().eq('id', id).then(function(res){
      if(res.error){ console.error(res.error); showToast('Could not delete palette'); return false; }
      if(!imagePath) return true;
      return sb.storage.from('palette-images').remove([imagePath]).then(function(storageRes){
        if(storageRes.error) console.error(storageRes.error);
        return true;
      });
    });
  }
  function deleteColorRemote(id){
    return sb.from('colors').delete().eq('id', id).then(function(res){
      if(res.error){ console.error(res.error); showToast('Could not delete color'); return false; }
      return true;
    });
  }
  function renameColorRemote(id, name){
    return sb.from('colors').update({name:name}).eq('id', id).then(function(res){
      if(res.error){ console.error(res.error); showToast('Could not rename color'); return false; }
      return true;
    });
  }
  function saveOwnedPaintsRemote(list){
    return sb.from('user_settings').upsert({user_id:currentUser.id, owned_paints:list}, {onConflict:'user_id'})
      .then(function(res){
        if(res.error){ console.error(res.error); showToast('Could not save your paint selection'); return false; }
        return true;
      });
  }

  /* ---------------- app state ---------------- */
  var state = {
    palettes: [],
    ownedPaints: PIGMENTS.map(function(p){return p.id;}),
    pickedColor: null,
    currentMix: null,
    currentMatch: 100,
    pickedPoint: null
  };

  /* ---------------- tabs ---------------- */
  var tabButtons = document.querySelectorAll('.tab');
  var tabPanels = document.querySelectorAll('.tab-panel');
  tabButtons.forEach(function(btn){
    btn.addEventListener('click', function(){
      tabButtons.forEach(function(b){ b.classList.remove('active'); });
      tabPanels.forEach(function(p){ p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
      if(btn.dataset.tab==='palettes') renderPalettes();
    });
  });

  /* ---------------- toast ---------------- */
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2400);
  }

  /* ---------------- image upload + canvas ---------------- */
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var canvasWrap = document.getElementById('canvasWrap');
  var changeRow = document.getElementById('changeRow');
  var canvas = document.getElementById('imgCanvas');
  var ctx = canvas.getContext('2d', {willReadFrequently:true});
  var samplePointer = document.getElementById('samplePointer');
  var loupe = document.getElementById('loupe');
  var loupeCanvas = document.getElementById('loupeCanvas');
  var loupeCtx = loupeCanvas.getContext('2d');
  var currentImage = null;

  function hashFile(file){
    return file.arrayBuffer().then(function(buf){
      return crypto.subtle.digest('SHA-256',buf);
    }).then(function(hash){
      return Array.from(new Uint8Array(hash)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    });
  }

  dropzone.addEventListener('click', function(){ fileInput.click(); });
  dropzone.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ fileInput.click(); } });
  document.getElementById('changeImageBtn').addEventListener('click', function(){ fileInput.click(); });

  ['dragover','dragenter'].forEach(function(evt){
    dropzone.addEventListener(evt, function(e){ e.preventDefault(); dropzone.classList.add('drag'); });
  });
  ['dragleave','drop'].forEach(function(evt){
    dropzone.addEventListener(evt, function(e){ e.preventDefault(); dropzone.classList.remove('drag'); });
  });
  dropzone.addEventListener('drop', function(e){
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) loadImageFile(f);
  });
  fileInput.addEventListener('change', function(){
    if(fileInput.files && fileInput.files[0]) loadImageFile(fileInput.files[0]);
  });

  function loadImageFile(file){
    if(!file.type || file.type.indexOf('image/')!==0) return;
    currentImage=null;
    samplePointer.classList.add('hidden');
    state.pickedPoint=null;
    var reader = new FileReader();
    reader.onload = function(e){
      var img = new Image();
      img.onload = function(){
        var maxDim = 1400;
        var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        hashFile(file).then(function(hash){
          currentImage={file:file,hash:hash,dataUrl:e.target.result,width:img.naturalWidth,height:img.naturalHeight};
        }).catch(function(err){console.error(err);showToast('Could not prepare this photo');});
        dropzone.classList.add('hidden');
        canvasWrap.classList.remove('hidden');
        changeRow.classList.remove('hidden');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function getPixelAt(clientX, clientY){
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var x = Math.floor((clientX - rect.left) * scaleX);
    var y = Math.floor((clientY - rect.top) * scaleY);
    x = Math.max(0, Math.min(canvas.width - 1, x));
    y = Math.max(0, Math.min(canvas.height - 1, y));
    var d = ctx.getImageData(x, y, 1, 1).data;
    return {r:d[0], g:d[1], b:d[2], x:x, y:y};
  }

  function updateLoupe(clientX, clientY, px){
    var rect = canvas.getBoundingClientRect();
    var localX = clientX - rect.left;
    var localY = clientY - rect.top;
    loupe.style.left = localX + 'px';
    loupe.style.top = localY + 'px';
    loupe.classList.remove('hidden');
    var half = 4;
    var sx = Math.max(0, Math.min(px.x - half, canvas.width - (half*2+1)));
    var sy = Math.max(0, Math.min(px.y - half, canvas.height - (half*2+1)));
    var sw = Math.min(half*2+1, canvas.width);
    var sh = Math.min(half*2+1, canvas.height);
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.clearRect(0,0,loupeCanvas.width, loupeCanvas.height);
    loupeCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, loupeCanvas.width, loupeCanvas.height);
  }

  function updateLivePointer(px){
    samplePointer.style.left=((px.x/canvas.width)*100)+'%';
    samplePointer.style.top=((px.y/canvas.height)*100)+'%';
    samplePointer.style.background=rgbToHex(px.r,px.g,px.b);
    samplePointer.classList.remove('hidden');
  }

  var dragging = false;
  canvas.addEventListener('pointerdown', function(e){
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    var px = getPixelAt(e.clientX, e.clientY);
    updateLoupe(e.clientX, e.clientY, px);
    updateLivePointer(px);
  });
  canvas.addEventListener('pointermove', function(e){
    if(!dragging) return;
    var px = getPixelAt(e.clientX, e.clientY);
    updateLoupe(e.clientX, e.clientY, px);
    updateLivePointer(px);
  });
  function endDrag(e){
    if(!dragging) return;
    dragging = false;
    loupe.classList.add('hidden');
    var px = getPixelAt(e.clientX, e.clientY);
    state.pickedPoint={x:px.x/canvas.width,y:px.y/canvas.height};
    updateLivePointer(px);
    commitPickedColor(px.r, px.g, px.b);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', function(){ dragging=false; loupe.classList.add('hidden'); });

  /* ---------------- mixing algorithm ---------------- */
  function colorDistSq(a,b){
    var dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2];
    return dr*dr+dg*dg+db*db;
  }
  function combos3(arr){
    var res=[], n=arr.length;
    for(var i=0;i<n-2;i++)
      for(var j=i+1;j<n-1;j++)
        for(var k=j+1;k<n;k++)
          res.push([arr[i],arr[j],arr[k]]);
    return res;
  }
  function bestMix(targetRgb, pool){
    if(pool.length < 3) pool = PIGMENTS.slice();
    var combos = combos3(pool);
    var step = 5;
    var best = null;
    for(var ci=0; ci<combos.length; ci++){
      var combo = combos[ci];
      var p1=combo[0], p2=combo[1], p3=combo[2];
      for(var a=0; a<=100; a+=step){
        for(var b=0; b<=100-a; b+=step){
          var c = 100 - a - b;
          var r = (p1.rgb[0]*a + p2.rgb[0]*b + p3.rgb[0]*c)/100;
          var g = (p1.rgb[1]*a + p2.rgb[1]*b + p3.rgb[1]*c)/100;
          var bl= (p1.rgb[2]*a + p2.rgb[2]*b + p3.rgb[2]*c)/100;
          var d = colorDistSq(targetRgb, [r,g,bl]);
          if(best===null || d<best.dist){
            best = {dist:d, combo:combo, weights:[a,b,c]};
          }
        }
      }
    }
    var result = best.combo.map(function(p,i){
      return {id:p.id, name:p.name, hex:p.hex, percent:best.weights[i]};
    }).filter(function(x){ return x.percent>0; });
    result.sort(function(x,y){ return y.percent - x.percent; });
    var maxDist = 3*255*255;
    var match = Math.round(Math.max(0, 100 - (Math.sqrt(best.dist)/Math.sqrt(maxDist))*100));
    return {mix:result, match:match};
  }

  function computeAndRenderMix(r,g,b){
    var pool = PIGMENTS.filter(function(p){ return state.ownedPaints.indexOf(p.id)>=0; });
    var out = bestMix([r,g,b], pool);
    state.currentMix = out.mix;
    state.currentMatch = out.match;
    renderRecipe();
  }

  function commitPickedColor(r,g,b){
    state.pickedColor = {r:r,g:g,b:b,hex:rgbToHex(r,g,b)};
    document.getElementById('pickedEmpty').classList.add('hidden');
    document.getElementById('pickedResult').classList.remove('hidden');
    document.getElementById('pickedSwatch').style.background = state.pickedColor.hex;
    document.getElementById('pickedHex').textContent = state.pickedColor.hex.toUpperCase();
    document.getElementById('colorNameInput').value = '';
    computeAndRenderMix(r,g,b);
  }

  function renderRecipe(){
    var stack = document.getElementById('recipeStack');
    var list = document.getElementById('recipeList');
    stack.innerHTML = '';
    list.innerHTML = '';
    state.currentMix.forEach(function(m){
      var seg = document.createElement('div');
      seg.className = 'recipe-seg';
      seg.style.width = m.percent + '%';
      seg.style.background = m.hex;
      stack.appendChild(seg);

      var li = document.createElement('li');
      var dot = document.createElement('span');
      dot.className = 'recipe-dot';
      dot.style.background = m.hex;
      var name = document.createElement('span');
      name.className = 'recipe-name';
      name.textContent = m.name;
      var pct = document.createElement('span');
      pct.className = 'recipe-pct';
      pct.textContent = m.percent + '%';
      li.appendChild(dot); li.appendChild(name); li.appendChild(pct);
      list.appendChild(li);
    });
  }

  /* ---------------- palette select ---------------- */
  var paletteSelect = document.getElementById('paletteSelect');
  var newPaletteRow = document.getElementById('newPaletteRow');
  var newPaletteInput = document.getElementById('newPaletteInput');

  function refreshPaletteSelect(preferId){
    var prev = paletteSelect.value;
    paletteSelect.innerHTML = '';
    state.palettes.forEach(function(p){
      var opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      paletteSelect.appendChild(opt);
    });
    var newOpt = document.createElement('option');
    newOpt.value = '__new__'; newOpt.textContent = '+ New palette…';
    paletteSelect.appendChild(newOpt);

    var exists = function(id){
      return Array.prototype.some.call(paletteSelect.options, function(o){ return o.value===id; });
    };
    if(preferId && exists(preferId)){
      paletteSelect.value = preferId;
    } else if(prev && prev !== '__new__' && exists(prev)){
      paletteSelect.value = prev;
    } else if(state.palettes.length){
      paletteSelect.value = state.palettes[state.palettes.length-1].id;
    } else {
      paletteSelect.value = '__new__';
    }
    newPaletteRow.classList.toggle('hidden', paletteSelect.value !== '__new__');
  }
  paletteSelect.addEventListener('change', function(){
    newPaletteRow.classList.toggle('hidden', paletteSelect.value !== '__new__');
  });

  /* ---------------- add to palette (async, hits Supabase) ---------------- */
  var addBtn = document.getElementById('addToPaletteBtn');
  addBtn.addEventListener('click', function(){
    if(!state.pickedColor || !state.currentMix || !state.pickedPoint){
      showToast('Sample a color first');
      return;
    }
    if(!currentImage){showToast('The photo is still being prepared. Try again in a moment.');return;}
    var originalLabel = addBtn.textContent;
    addBtn.disabled = true;
    addBtn.textContent = 'Saving…';

    var creatingNew = (paletteSelect.value === '__new__');
    var paletteStep;
    if(creatingNew){
      var name = (newPaletteInput.value || '').trim() || 'Untitled palette';
      paletteStep = createPaletteRemote(name).then(function(pal){
        if(pal) state.palettes.push(pal);
        return pal;
      });
    } else {
      paletteStep = Promise.resolve(state.palettes.filter(function(p){ return p.id===paletteSelect.value; })[0] || null);
    }

    paletteStep.then(function(targetPalette){
      if(!targetPalette){
        showToast('Choose or create a palette first');
        return;
      }
      var colorName = (document.getElementById('colorNameInput').value || '').trim();
      if(!colorName) colorName = 'Color ' + (targetPalette.colors.length + 1);

      return attachImageToPalette(targetPalette).then(function(imageOK){
        if(!imageOK) return;
        return addColorRemote(targetPalette.id, {
          name: colorName, hex: state.pickedColor.hex, mix: state.currentMix, match: state.currentMatch,
          pointX:state.pickedPoint.x, pointY:state.pickedPoint.y
        }).then(function(savedColor){
          if(!savedColor) return;
          targetPalette.colors.push(savedColor);
          newPaletteInput.value = '';
          refreshPaletteSelect(targetPalette.id);
          renderPalettes();
          showToast('Saved to ' + targetPalette.name);
        });
      });
    }).finally(function(){
      addBtn.disabled = false;
      addBtn.textContent = originalLabel;
    });
  });

  /* ---------------- palettes tab ---------------- */
  var palettesList = document.getElementById('palettesList');
  var palettesEmpty = document.getElementById('palettesEmpty');

  var paletteDetail = document.getElementById('paletteDetail');

  function renderPalettes(){
    palettesList.innerHTML = '';
    paletteDetail.classList.add('hidden');
    paletteDetail.innerHTML = '';
    palettesList.classList.remove('hidden');
    document.querySelector('.palettes-header').classList.remove('hidden');
    palettesEmpty.classList.toggle('hidden', state.palettes.length>0);

    state.palettes.forEach(function(pal){
      var card = document.createElement('div');
      card.className = 'palette-card';
      card.setAttribute('role','button');
      card.setAttribute('tabindex','0');

      var head = document.createElement('div');
      head.className = 'palette-card-head';

      var titleWrap = document.createElement('div');
      titleWrap.className = 'palette-card-title';
      var nameEl = document.createElement('span');
      nameEl.className = 'palette-name'; nameEl.textContent = pal.name;
      var countEl = document.createElement('span');
      countEl.className = 'palette-count'; countEl.textContent = pal.colors.length + (pal.colors.length===1?' color':' colors');
      titleWrap.appendChild(nameEl); titleWrap.appendChild(countEl);

      var actions = document.createElement('div');
      actions.className = 'palette-card-actions';

      var menuBtn = document.createElement('button');
      menuBtn.className = 'icon-btn';
      menuBtn.title = 'Palette options';
      menuBtn.textContent = '•••';

      var menu = document.createElement('div');
      menu.className = 'palette-menu hidden';

      /* RENAME */
      var renameBtn = document.createElement('button');
      renameBtn.className = 'palette-menu-item';
      renameBtn.textContent = 'Rename';

      renameBtn.addEventListener('click', function(e){
        e.stopPropagation();

        var newName = prompt('Rename palette:', pal.name);

        if(newName === null) return;

        newName = newName.trim();

        if(!newName || newName === pal.name) return;

        renamePaletteRemote(pal.id, newName).then(function(ok){
          if(!ok) return;

          pal.name = newName;
          refreshPaletteSelect(pal.id);
          renderPalettes();
          showToast('Palette renamed');
        });
      });


      /* DELETE */
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'palette-menu-item delete';
      deleteBtn.textContent = 'Delete';

      deleteBtn.addEventListener('click', function(e){
        e.stopPropagation();

        if(!confirm('Are you sure you want to delete "' + pal.name + '" and all its colors?')){
          return;
        }

        deletePaletteRemote(pal.id, pal.referenceImagePath).then(function(ok){
          if(!ok) return;

          state.palettes = state.palettes.filter(function(p){
            return p.id !== pal.id;
          });

          refreshPaletteSelect();
          renderPalettes();
          showToast('Palette deleted');
        });
      });


      /* OPEN / CLOSE MENU */
      menuBtn.addEventListener('click', function(e){
        e.stopPropagation();

        document.querySelectorAll('.palette-menu').forEach(function(otherMenu){
          if(otherMenu !== menu){
            otherMenu.classList.add('hidden');
          }
        });

        menu.classList.toggle('hidden');
      });


      menu.appendChild(renameBtn);
      menu.appendChild(deleteBtn);

      actions.appendChild(menuBtn);
      actions.appendChild(menu);
      head.appendChild(titleWrap); head.appendChild(actions);

      var preview = document.createElement('div');
      preview.className = 'palette-preview';
      if(pal.colors.length){
        pal.colors.slice(-6).forEach(function(c){
          var seg=document.createElement('span'); seg.style.background=c.hex; preview.appendChild(seg);
        });
      }else{
        var empty=document.createElement('span'); empty.style.background='#2C2C29'; preview.appendChild(empty);
      }

      card.appendChild(head); card.appendChild(preview);
      card.addEventListener('click', function(){ openPaletteDetail(pal); });
      card.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();openPaletteDetail(pal);} });
      palettesList.appendChild(card);
    });
  }

  function openPaletteDetail(pal){
    palettesList.classList.add('hidden');
    palettesEmpty.classList.add('hidden');
    document.querySelector('.palettes-header').classList.add('hidden');
    paletteDetail.classList.remove('hidden');
    renderPaletteDetail(pal);
  }

  function renderPaletteDetail(pal){
    paletteDetail.innerHTML='';
    var top=document.createElement('div'); top.className='palette-detail-top';
    var left=document.createElement('div');
    var titleRow=document.createElement('div'); titleRow.className='palette-detail-title-row';
    var back=document.createElement('button'); back.className='palette-back'; back.textContent='←'; back.title='Back to palettes';
    back.addEventListener('click', renderPalettes);
    var titleWrap=document.createElement('div');
    var title=document.createElement('h2'); title.className='palette-detail-title'; title.textContent=pal.name;
    var count=document.createElement('div'); count.className='palette-detail-count'; count.textContent=pal.colors.length+(pal.colors.length===1?' color':' colors');
    titleWrap.appendChild(title); titleWrap.appendChild(count); titleRow.appendChild(back); titleRow.appendChild(titleWrap); left.appendChild(titleRow);
    var add=document.createElement('button'); add.className='primary-btn small'; add.textContent='+ Add color';
    add.addEventListener('click',function(){ document.querySelector('[data-tab="mix"]').click(); refreshPaletteSelect(pal.id); });
    top.appendChild(left); top.appendChild(add); paletteDetail.appendChild(top);

    if(!pal.colors.length){
      var empty=document.createElement('div'); empty.className='empty-state'; empty.textContent='No colors in this palette yet.'; paletteDetail.appendChild(empty); return;
    }
    if(pal.referenceImageUrl){
      var photoLayout=document.createElement('div'); photoLayout.className='palette-photo-layout';
      var photoWrap=document.createElement('div'); photoWrap.className='palette-photo-wrap';
      var photo=document.createElement('img'); photo.className='palette-photo'; photo.src=pal.referenceImageUrl; photo.alt='Reference photo for '+pal.name;
      photoWrap.appendChild(photo);
      var recipePanel=document.createElement('aside'); recipePanel.className='pointer-recipe';
      var recipeEmpty=document.createElement('div'); recipeEmpty.className='pointer-recipe-empty'; recipeEmpty.textContent='Click a pointer on the photo to view that color’s paint recipe.';
      recipePanel.appendChild(recipeEmpty);

      function showPointerRecipe(color,button){
        Array.prototype.forEach.call(photoWrap.querySelectorAll('.photo-pointer'),function(p){p.classList.remove('active');});
        Array.prototype.forEach.call(photoLayout.querySelectorAll('.overview-color'),function(p){p.classList.toggle('active',p.dataset.colorId===String(color.id));});
        button.classList.add('active');
        recipePanel.innerHTML='';
        var swatch=document.createElement('div'); swatch.className='pointer-recipe-swatch'; swatch.style.background=color.hex;
        var recipeName=document.createElement('div'); recipeName.className='pointer-recipe-name'; recipeName.textContent=color.name;
        var recipeHex=document.createElement('div'); recipeHex.className='pointer-recipe-hex'; recipeHex.textContent=color.hex.toUpperCase();
        var recipeList=document.createElement('ul'); recipeList.className='pointer-recipe-list';
        (color.mix||[]).forEach(function(m){
          var item=document.createElement('li');
          var dot=document.createElement('span'); dot.className='pointer-recipe-dot'; dot.style.background=m.hex;
          var paintName=document.createElement('span'); paintName.textContent=m.name;
          var percent=document.createElement('strong'); percent.textContent=m.percent+'%';
          item.appendChild(dot);item.appendChild(paintName);item.appendChild(percent);recipeList.appendChild(item);
        });
        recipePanel.appendChild(swatch);recipePanel.appendChild(recipeName);recipePanel.appendChild(recipeHex);recipePanel.appendChild(recipeList);
      }

      pal.colors.forEach(function(c){
        if(typeof c.pointX!=='number'||typeof c.pointY!=='number') return;
        var pointer=document.createElement('button'); pointer.className='photo-pointer'; pointer.type='button';
        pointer.style.left=(c.pointX*100)+'%';pointer.style.top=(c.pointY*100)+'%';pointer.style.background=c.hex;
        pointer.title=c.name+' — view recipe';pointer.setAttribute('aria-label','View recipe for '+c.name);
        pointer.dataset.colorId=String(c.id);
        pointer.addEventListener('click',function(){showPointerRecipe(c,pointer);});
        photoWrap.appendChild(pointer);
      });

      var sidebar=document.createElement('div'); sidebar.className='palette-sidebar-column';
      var overview=document.createElement('div'); overview.className='palette-sidebar-overview';
      var colorsSection=document.createElement('section'); colorsSection.className='sidebar-section';
      var colorsHeading=document.createElement('div'); colorsHeading.className='sidebar-heading'; colorsHeading.textContent='Palette overview';
      var overviewColors=document.createElement('div'); overviewColors.className='overview-colors';
      pal.colors.forEach(function(c){
        var chip=document.createElement('button'); chip.type='button'; chip.className='overview-color'; chip.dataset.colorId=String(c.id);
        var chipDot=document.createElement('span'); chipDot.className='overview-dot'; chipDot.style.background=c.hex;
        var chipName=document.createElement('span'); chipName.textContent=c.name;
        chip.appendChild(chipDot);chip.appendChild(chipName);
        chip.addEventListener('click',function(){
          var pointer=photoWrap.querySelector('.photo-pointer[data-color-id="'+String(c.id)+'"]');
          if(pointer) showPointerRecipe(c,pointer);
        });
        overviewColors.appendChild(chip);
      });
      colorsSection.appendChild(colorsHeading);colorsSection.appendChild(overviewColors);

      var paintsSection=document.createElement('section'); paintsSection.className='sidebar-section';
      var paintsHeading=document.createElement('div'); paintsHeading.className='sidebar-heading'; paintsHeading.textContent='Paints needed for this palette';
      var neededPaints=document.createElement('div'); neededPaints.className='needed-paints';
      var uniquePaints={};
      pal.colors.forEach(function(c){(c.mix||[]).forEach(function(m){if(!uniquePaints[m.name]) uniquePaints[m.name]=m;});});
      Object.keys(uniquePaints).forEach(function(name){
        var m=uniquePaints[name];var paint=document.createElement('div');paint.className='needed-paint';
        var paintDot=document.createElement('span');paintDot.className='needed-paint-dot';paintDot.style.background=m.hex;
        var paintName=document.createElement('span');paintName.textContent=name;
        paint.appendChild(paintDot);paint.appendChild(paintName);neededPaints.appendChild(paint);
      });
      paintsSection.appendChild(paintsHeading);paintsSection.appendChild(neededPaints);
      overview.appendChild(colorsSection);overview.appendChild(paintsSection);
      sidebar.appendChild(recipePanel);sidebar.appendChild(overview);
      photoLayout.appendChild(photoWrap);photoLayout.appendChild(sidebar);paletteDetail.appendChild(photoLayout);
    }
    var grid=document.createElement('div'); grid.className='palette-detail-grid';
    pal.colors.slice().reverse().forEach(function(c){
      var card=document.createElement('div'); card.className='detail-color-card';
      var sw=document.createElement('div'); sw.className='detail-color-swatch'; sw.style.background=c.hex;
      var del=document.createElement('button'); del.className='detail-delete'; del.textContent='×'; del.title='Delete color';
      del.addEventListener('click',function(){
        if(!confirm('Delete "'+c.name+'"?')) return;
        deleteColorRemote(c.id).then(function(ok){ if(!ok)return; pal.colors=pal.colors.filter(function(x){return x.id!==c.id;}); renderPaletteDetail(pal); refreshPaletteSelect(pal.id); });
      });
      var info=document.createElement('div'); info.className='detail-color-info';
      var hex=document.createElement('div'); hex.className='detail-color-hex'; hex.textContent=c.hex.toUpperCase();
      var nm=document.createElement('div'); nm.className='detail-color-name'; nm.textContent=c.name;
      var recipe=document.createElement('div'); recipe.className='detail-color-recipe'; recipe.textContent=(c.mix||[]).map(function(m){return m.percent+'% '+m.name;}).join(' · ');
      info.appendChild(hex); info.appendChild(nm); info.appendChild(recipe); card.appendChild(sw); card.appendChild(del); card.appendChild(info); grid.appendChild(card);
    });
    paletteDetail.appendChild(grid);
  }

  function renderColorRow(pal, c){
    var row = document.createElement('div');
    row.className = 'color-row';

    var sw = document.createElement('div');
    sw.className = 'swatch'; sw.style.background = c.hex;

    var main = document.createElement('div');
    main.className = 'color-row-main';

    var top = document.createElement('div');
    top.className = 'color-row-top';

    var nameInput = document.createElement('input');
    nameInput.className = 'color-name-input';
    nameInput.value = c.name;
    nameInput.addEventListener('change', function(){
      var newName = nameInput.value.trim() || c.name;
      renameColorRemote(c.id, newName).then(function(ok){
        if(ok) c.name = newName; else nameInput.value = c.name;
      });
    });

    var right = document.createElement('div');
    right.style.display='flex'; right.style.alignItems='center'; right.style.gap='8px'; right.style.flexShrink='0';
    var match = document.createElement('span');
    match.className = 'color-match'; match.textContent = c.match + '% match';
    var delBtn = document.createElement('button');
    delBtn.className = 'icon-btn'; delBtn.title='Delete color'; delBtn.textContent='✕';
    delBtn.addEventListener('click', function(){
      deleteColorRemote(c.id).then(function(ok){
        if(!ok) return;
        pal.colors = pal.colors.filter(function(x){ return x.id!==c.id; });
        renderPalettes();
      });
    });
    right.appendChild(match); right.appendChild(delBtn);

    top.appendChild(nameInput);
    top.appendChild(right);

    var recipe = document.createElement('div');
    recipe.className = 'color-recipe';
    recipe.innerHTML = c.mix.map(function(m){ return '<b>'+m.percent+'%</b> '+m.name; }).join(' · ');

    main.appendChild(top);
    main.appendChild(recipe);
    row.appendChild(sw);
    row.appendChild(main);
    return row;
  }

  document.getElementById('newPaletteBtn2').addEventListener('click', function(){
    document.getElementById('newPaletteForm2').classList.toggle('hidden');
    document.getElementById('newPaletteInput2').focus();
  });
  document.getElementById('confirmNewPalette2').addEventListener('click', function(){
    var input = document.getElementById('newPaletteInput2');
    var name = input.value.trim();
    if(!name) return;
    createPaletteRemote(name).then(function(newPal){
      if(!newPal) return;
      state.palettes.push(newPal);
      input.value = '';
      document.getElementById('newPaletteForm2').classList.add('hidden');
      refreshPaletteSelect(newPal.id);
      renderPalettes();
      showToast('Palette created');
    });
  });

  /* ---------------- paints tab ---------------- */
  var paintsGrid = document.getElementById('paintsGrid');
  var paintsNote = document.getElementById('paintsNote');

  function renderPaints(){
    paintsGrid.innerHTML = '';
    PIGMENTS.forEach(function(p){
      var chip = document.createElement('label');
      chip.className = 'paint-chip' + (state.ownedPaints.indexOf(p.id)>=0 ? ' checked' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.ownedPaints.indexOf(p.id)>=0;
      cb.addEventListener('change', function(){
        var idx = state.ownedPaints.indexOf(p.id);
        var next = state.ownedPaints.slice();
        if(cb.checked && idx<0){
          next.push(p.id);
        } else if(!cb.checked && idx>=0){
          if(next.length<=3){
            cb.checked = true;
            paintsNote.textContent = 'Keep at least three paints checked so palette can mix combinations.';
            setTimeout(function(){ paintsNote.textContent=''; }, 2600);
            return;
          }
          next.splice(idx,1);
        }
        state.ownedPaints = next;
        chip.classList.toggle('checked', cb.checked);
        saveOwnedPaintsRemote(next);
      });
      var sw = document.createElement('span');
      sw.className = 'paint-swatch'; sw.style.background = p.hex;
      var nm = document.createElement('span');
      nm.className = 'paint-name'; nm.textContent = p.name;
      chip.appendChild(cb); chip.appendChild(sw); chip.appendChild(nm);
      paintsGrid.appendChild(chip);
    });
  }

  /* ---------------- boot after sign-in ---------------- */
  function bootData(){
    Promise.all([fetchAllPalettes(), fetchOwnedPaints()]).then(function(res){
      state.palettes = res[0] || [];
      state.ownedPaints = (res[1] && res[1].length>=3) ? res[1] : PIGMENTS.map(function(p){return p.id;});
      refreshPaletteSelect();
      renderPalettes();
      renderPaints();
    });
  }

  initAuth();

})();
