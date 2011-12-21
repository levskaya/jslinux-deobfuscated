/*
Fabrix - An annotated version of the original JSLinux which is Copyright (c) 2011 Fabrice Bellard

Main PC Emulator Routine
*/

function set_hard_irq_wrapper(irq) { this.hard_irq = irq;}

function return_cycle_count() { return this.cycle_count; }

function PCEmulator(uh) {
    var cpu;
    cpu = new CPU_X86();
    this.cpu = cpu;
    cpu.phys_mem_resize(uh.mem_size);
    this.init_ioports();
    this.register_ioport_write(0x80, 1, 1, this.ioport80_write);
    this.pic    = new PIC_Controller(this, 0x20, 0xa0, set_hard_irq_wrapper.bind(cpu));
    this.pit    = new PIT(this, this.pic.set_irq.bind(this.pic, 0),  return_cycle_count.bind(cpu));
    this.cmos   = new CMOS(this);
    this.serial = new Serial(this, 0x3f8, this.pic.set_irq.bind(this.pic, 4), uh.serial_write);
    this.kbd    = new KBD(this, this.reset.bind(this));
    this.reset_request = 0;
    if (uh.clipboard_get && uh.clipboard_set) {
        this.jsclipboard = new clipboard_device(this, 0x3c0, uh.clipboard_get, uh.clipboard_set, uh.get_boot_time);
    }
    cpu.ld8_port       = this.ld8_port.bind(this);
    cpu.ld16_port      = this.ld16_port.bind(this);
    cpu.ld32_port      = this.ld32_port.bind(this);
    cpu.st8_port       = this.st8_port.bind(this);
    cpu.st16_port      = this.st16_port.bind(this);
    cpu.st32_port      = this.st32_port.bind(this);
    cpu.get_hard_intno = this.pic.get_hard_intno.bind(this.pic);
}

PCEmulator.prototype.load_binary = function(Gg, ha) { return this.cpu.load_binary(Gg, ha); };

PCEmulator.prototype.start = function() { setTimeout(this.timer_func.bind(this), 10); };

PCEmulator.prototype.timer_func = function() {
    var La, vh, wh, xh, yh, Ng, cpu;
    Ng = this;
    cpu = Ng.cpu;
    wh = cpu.cycle_count + 100000;
    xh = false;
    yh = false;
    zh: while (cpu.cycle_count < wh) {
        Ng.pit.update_irq();
        La = cpu.exec(wh - cpu.cycle_count);
        if (La == 256) {
            if (Ng.reset_request) {
                xh = true;
                break;
            }
        } else if (La == 257) {
            yh = true;
            break;
        } else {
            xh = true;
            break;
        }
    }
    if (!xh) {
        if (yh) {
            setTimeout(this.timer_func.bind(this), 10);
        } else {
            setTimeout(this.timer_func.bind(this), 0);
        }
    }
};

PCEmulator.prototype.init_ioports = function() {
    var i, Ah, Bh;
    this.ioport_readb_table = new Array();
    this.ioport_writeb_table = new Array();
    this.ioport_readw_table = new Array();
    this.ioport_writew_table = new Array();
    this.ioport_readl_table = new Array();
    this.ioport_writel_table = new Array();
    Ah = this.default_ioport_readw.bind(this);
    Bh = this.default_ioport_writew.bind(this);
    for (i = 0; i < 1024; i++) {
        this.ioport_readb_table[i] = this.default_ioport_readb;
        this.ioport_writeb_table[i] = this.default_ioport_writeb;
        this.ioport_readw_table[i] = Ah;
        this.ioport_writew_table[i] = Bh;
        this.ioport_readl_table[i] = this.default_ioport_readl;
        this.ioport_writel_table[i] = this.default_ioport_writel;
    }
};

PCEmulator.prototype.default_ioport_readb = function(Zf) {
    var x;
    x = 0xff;
    return x;
};

PCEmulator.prototype.default_ioport_readw = function(Zf) {
    var x;
    x = this.ioport_readb_table[Zf](Zf);
    Zf = (Zf + 1) & (1024 - 1);
    x |= this.ioport_readb_table[Zf](Zf) << 8;
    return x;
};

PCEmulator.prototype.default_ioport_readl = function(Zf) {
    var x;
    x = -1;
    return x;
};

PCEmulator.prototype.default_ioport_writeb = function(Zf, x) {};

PCEmulator.prototype.default_ioport_writew = function(Zf, x) {
    this.ioport_writeb_table[Zf](Zf, x & 0xff);
    Zf = (Zf + 1) & (1024 - 1);
    this.ioport_writeb_table[Zf](Zf, (x >> 8) & 0xff);
};

PCEmulator.prototype.default_ioport_writel = function(Zf, x) {};

PCEmulator.prototype.ld8_port = function(Zf) {
    var x;
    x = this.ioport_readb_table[Zf & (1024 - 1)](Zf);
    return x;
};

PCEmulator.prototype.ld16_port = function(Zf) {
    var x;
    x = this.ioport_readw_table[Zf & (1024 - 1)](Zf);
    return x;
};

PCEmulator.prototype.ld32_port = function(Zf) {
    var x;
    x = this.ioport_readl_table[Zf & (1024 - 1)](Zf);
    return x;
};

PCEmulator.prototype.st8_port  = function(Zf, x) { this.ioport_writeb_table[Zf & (1024 - 1)](Zf, x); };
PCEmulator.prototype.st16_port = function(Zf, x) { this.ioport_writew_table[Zf & (1024 - 1)](Zf, x); };
PCEmulator.prototype.st32_port = function(Zf, x) { this.ioport_writel_table[Zf & (1024 - 1)](Zf, x); };

PCEmulator.prototype.register_ioport_read = function(start, tg, cc, Ch) {
    var i;
    switch (cc) {
        case 1:
            for (i = start; i < start + tg; i++) {
                this.ioport_readb_table[i] = Ch;
            }
            break;
        case 2:
            for (i = start; i < start + tg; i += 2) {
                this.ioport_readw_table[i] = Ch;
            }
            break;
        case 4:
            for (i = start; i < start + tg; i += 4) {
                this.ioport_readl_table[i] = Ch;
            }
            break;
    }
};

PCEmulator.prototype.register_ioport_write = function(start, tg, cc, Ch) {
    var i;
    switch (cc) {
        case 1:
            for (i = start; i < start + tg; i++) {
                this.ioport_writeb_table[i] = Ch;
            }
            break;
        case 2:
            for (i = start; i < start + tg; i += 2) {
                this.ioport_writew_table[i] = Ch;
            }
            break;
        case 4:
            for (i = start; i < start + tg; i += 4) {
                this.ioport_writel_table[i] = Ch;
            }
            break;
    }
};

PCEmulator.prototype.ioport80_write = function(mem8_loc, Ig) {};
PCEmulator.prototype.reset = function() { this.request_request = 1; };



