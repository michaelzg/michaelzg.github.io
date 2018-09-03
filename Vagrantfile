
Vagrant.configure("2") do |config|
  config.vm.box = "bento/ubuntu-16.04"
  config.vm.network "forwarded_port", guest: 8081, host: 8081
  config.vm.provision "shell", inline: <<-SHELL
    apt-get update
  SHELL
end
