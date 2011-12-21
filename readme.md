De-obfuscated JSLinux
=========================================================

I wanted to understand how the amazing [JsLinux][1] worked.  However,  Mr Bellard seems to have applied a decidedly french proclivity towards obfuscatory algorithmic prose, replete with two-letter variable names and the like...

So in order to better understand the code, I started transforming all the symbols, which isn't all that hard a thing to do given that it's been built to imitate a very well-specified piece of hardware.

### Stats

It's still absolutely ungainly, but not nearly so ungainly as the original.  About a third to a half of the variables/function names have been redescribed.

I highly recommend, by the way, the excellent [JSShaper][2] library for transforming large javascript code bases.

### Caveat Coder

This is an artistic reinterpretation of Fabrice Bellard's original code.  There's no alteration in the acutal algorithmic content.  I do make sure that it still runs.  I can't guarantee anything else.

[1]: http://bellard.org/jslinux/tech.html
[2]: http://sshaper.org
