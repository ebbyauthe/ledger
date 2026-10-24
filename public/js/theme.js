const STORAGE_KEY = 'ledger-theme';

export function getTheme(){
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme){
  document.documentElement.dataset.theme = theme;
  try{ localStorage.setItem(STORAGE_KEY, theme); }catch(e){}
}

export function toggleTheme(){
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
