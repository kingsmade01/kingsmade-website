async function login(){
  $('loginError').textContent='';
  $('loginBtn').disabled=true;

  try{
    await api('/api/login',{
      method:'POST',
      body:JSON.stringify({password:$('loginPassword').value})
    });

    $('loginPassword').value='';
    showApp();
    await loadAll();

    clearInterval(window.kmOrderPolling);
    window.kmOrderPolling=setInterval(checkNewOrders,60000);

  }catch(e){
    $('loginError').textContent=e.message;
  }finally{
    $('loginBtn').disabled=false;
  }
}
