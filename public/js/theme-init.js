(function(){
  try{
    var stored = localStorage.getItem('ledger-theme');
    var theme = stored || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  }catch(e){}
})();
