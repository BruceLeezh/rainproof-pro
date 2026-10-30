const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../..', '05-演示站点');
const order = ['insurance.html', 'index-v6.html#dashboard', 'rider.html', 'console.html', 'verify-v6.html'];
for (const file of ['insurance.html','index-v6.html','rider.html','console.html','verify-v6.html','terms.html']) {
  const target = path.join(root,file);
  let html = fs.readFileSync(target,'utf8');
  html = html.replace(/(<nav class="rp-menu"[^>]*>)([\s\S]*?)(<\/nav>)/, (_,start,body,end) => {
    const anchors = body.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || [];
    if (anchors.length !== order.length) throw new Error('Unexpected navigation: '+file);
    return start + order.map(href => {
      const anchor = anchors.find(a=>a.includes('href="'+href+'"'));
      if (!anchor) throw new Error('Missing navigation entry: '+href);
      return anchor;
    }).join('') + end;
  });
  fs.writeFileSync(target,html);
  console.log('Navigation updated: '+file);
}
